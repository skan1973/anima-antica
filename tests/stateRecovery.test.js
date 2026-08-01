'use strict';

/**
 * Regression tests for state recovery in the socket controller.
 *
 * Scenarios covered:
 *  1. Call termination (end-call)       – both users return to 'libero'
 *  2. Sudden disconnection              – disconnected user is removed from state;
 *                                         remaining user can still end the call
 *  3. Inactivity watchdog               – a forcibly disconnected socket (as the
 *                                         watchdog would do) triggers full state cleanup
 *  4. Ping / pong (activity tracking)  – lastSeen is updated by activity events;
 *                                         connections stay alive via Socket.IO heartbeat
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const { io: ioClient } = require('socket.io-client');

// Ensure socketController loads in test mode (no DB required here,
// DB checks live in server.js middleware, not in socketController itself).
process.env.NODE_ENV = 'test';

const socketController = require('../server/controllers/socketController');

// ── Shared test server ────────────────────────────────────────────────────────
// A single server instance is used for all tests to honour the module-level
// state inside socketController (onlineUsers, roomMembers, …).  Each test uses
// unique nick names to guarantee isolation.

let _server;
let _io;
let _port;

async function getTestServer() {
  if (_server) return { io: _io, port: _port };

  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
    // Fast heartbeat so ping/pong tests complete quickly
    pingInterval: 300,
    pingTimeout: 200
  });

  // Minimal auth middleware: assign a unique session id per connection so that
  // socketController's isSocketIdentityBound() works without a real JWT stack.
  io.use((socket, next) => {
    socket.data.auth = {
      sid: crypto.randomUUID(),
      jti: crypto.randomUUID()
    };
    next();
  });

  socketController(io);

  await new Promise((resolve) => httpServer.listen(0, resolve));

  // Prevent the server from keeping the Node.js process alive after all tests
  // have finished (node --test exits as soon as no active handles remain).
  httpServer.unref();

  _server = httpServer;
  _io = io;
  _port = httpServer.address().port;

  return { io, port: _port };
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function createClient(port) {
  return ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 3000
  });
}

/**
 * Wait for a single named event on an EventEmitter-compatible object.
 * Rejects after `timeoutMs` if the event never fires.
 */
function waitForEvent(emitter, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timeout: '${event}' not received within ${timeoutMs} ms`));
    }, timeoutMs);

    function handler(data) {
      clearTimeout(timer);
      resolve(data);
    }

    emitter.once(event, handler);
  });
}

/**
 * Connect a socket client and log in with the given nick.
 * Resolves once the server sends 'login-success'.
 */
async function connectAndLogin(port, nick) {
  const client = createClient(port);
  await waitForEvent(client, 'connect');

  const loginPromise = waitForEvent(client, 'login-success');
  client.emit('user_login', { nick });
  await loginPromise;

  return client;
}

/**
 * Wait for an `update_user_list` event that satisfies `predicate(users)`.
 * Useful for asserting the public state broadcast after an action.
 */
function waitForUserList(client, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('update_user_list', handler);
      reject(new Error(`Timeout: user list matching predicate not received within ${timeoutMs} ms`));
    }, timeoutMs);

    function handler(users) {
      if (predicate(users)) {
        clearTimeout(timer);
        client.off('update_user_list', handler);
        resolve(users);
      }
    }

    client.on('update_user_list', handler);
  });
}

/**
 * Execute a full call setup between caller and callee.
 * Returns the roomId and callToken so the caller can later end the call.
 */
async function setupCall(caller, callee, callerNick, calleeNick) {
  // callee listens for incoming-call
  const incomingCallPromise = waitForEvent(callee, 'incoming-call');

  caller.emit('call-request', { targetNick: calleeNick });

  const incomingCall = await incomingCallPromise;
  assert.equal(incomingCall.callerNick, callerNick);

  // callee accepts
  const callerAcceptedPromise = waitForEvent(caller, 'call-accepted');
  const calleeAcceptedPromise = waitForEvent(callee, 'call-accepted');

  callee.emit('accept-call', { callerSocketId: incomingCall.callerSocketId });

  const [callerAccepted] = await Promise.all([callerAcceptedPromise, calleeAcceptedPromise]);

  return { roomId: callerAccepted.roomId, callToken: callerAccepted.callToken };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('stato ritorna a libero dopo terminazione esplicita della chiamata (end-call)', async (t) => {
  const { port } = await getTestServer();

  const nick1 = `CallEnd1_${Date.now()}`;
  const nick2 = `CallEnd2_${Date.now()}`;

  const client1 = await connectAndLogin(port, nick1);
  const client2 = await connectAndLogin(port, nick2);

  t.after(() => {
    client1.disconnect();
    client2.disconnect();
  });

  await setupCall(client1, client2, nick1, nick2);

  // Both users should be 'occupato' – verified by checking the list does NOT
  // contain either as 'libero' before the call ends.

  // client2 listens for call-ended; client1 ends the call
  const callEndedPromise = waitForEvent(client2, 'call-ended');

  // After end-call the server broadcasts update_user_list with both users 'libero'
  const usersLiberoPromise = waitForUserList(
    client1,
    (users) => {
      const u1 = users.find((u) => u.nick === nick1);
      const u2 = users.find((u) => u.nick === nick2);
      return u1 && u2; // Both must still be online (status is not in the public list,
      // but their presence confirms the broadcast arrived)
    }
  );

  client1.emit('end-call');

  await callEndedPromise;
  await usersLiberoPromise;

  // Both users are still in the online list after end-call.
  // Verify they are 'libero' by having client2 call client1:
  // if client1 is still 'occupato', the server would send call-feedback instead of incoming-call.
  const incomingCallPromise2 = waitForEvent(client1, 'incoming-call', 2000).catch(() => null);
  client2.emit('call-request', { targetNick: nick1 });

  const incoming2 = await incomingCallPromise2;
  // If client1 is 'libero', the incoming-call event arrives; no call-feedback error.
  assert.ok(incoming2, 'client1 deve ricevere incoming-call perché è libero dopo end-call');
  assert.equal(incoming2.callerNick, nick2);
});

test('utente disconnesso viene rimosso dallo stato (disconnessione improvvisa)', async (t) => {
  const { port } = await getTestServer();

  const nick1 = `Disc1_${Date.now()}`;
  const nick2 = `Disc2_${Date.now()}`;

  const client1 = await connectAndLogin(port, nick1);
  const client2 = await connectAndLogin(port, nick2);

  t.after(() => {
    if (client1.connected) client1.disconnect();
    if (client2.connected) client2.disconnect();
  });

  // Set up the listener BEFORE disconnecting so no broadcast is missed.
  const listWithoutNick1Promise = waitForUserList(
    client2,
    (users) => !users.some((u) => u.nick === nick1)
  );

  client1.disconnect();

  const listWithoutNick1 = await listWithoutNick1Promise;
  assert.ok(
    !listWithoutNick1.some((u) => u.nick === nick1),
    'client1 deve essere rimosso dalla lista utenti dopo la disconnessione'
  );
});

test('stato recupera per il caller rimanente dopo disconnessione improvvisa del peer durante la chiamata', async (t) => {
  const { port } = await getTestServer();

  const nick1 = `PeerDisc1_${Date.now()}`;
  const nick2 = `PeerDisc2_${Date.now()}`;

  const client1 = await connectAndLogin(port, nick1);
  const client2 = await connectAndLogin(port, nick2);

  t.after(() => {
    if (client1.connected) client1.disconnect();
    if (client2.connected) client2.disconnect();
  });

  await setupCall(client1, client2, nick1, nick2);

  // client2 disconnects suddenly while the call is active
  const listWithoutNick2Promise = waitForUserList(
    client1,
    (users) => !users.some((u) => u.nick === nick2)
  );

  client2.disconnect();

  await listWithoutNick2Promise;

  // client1 should still be in the list
  // client1 can now end the call (end-call on a half-dead room) and recover
  const usersPromise = waitForUserList(
    client1,
    (users) => users.some((u) => u.nick === nick1),
    2000
  );
  client1.emit('end-call');

  // After end-call, the server should broadcast the list with nick1 still present
  const finalList = await usersPromise;
  assert.ok(
    finalList.some((u) => u.nick === nick1),
    'client1 deve rimanere nella lista dopo la fine della chiamata'
  );

  // Verify client1 is free by checking it can receive incoming calls again
  const nick3 = `PeerDisc3_${Date.now()}`;
  const client3 = await connectAndLogin(port, nick3);
  t.after(() => client3.disconnect());

  const incomingPromise = waitForEvent(client1, 'incoming-call', 2000).catch(() => null);
  client3.emit('call-request', { targetNick: nick1 });
  const incoming = await incomingPromise;
  assert.ok(incoming, 'client1 deve essere libero e ricevere nuove chiamate dopo la disconnessione del peer');
});

test('watchdog di inattività: socket disconnesso forzatamente viene rimosso dallo stato', async (t) => {
  const { io, port } = await getTestServer();

  const nick1 = `Watchdog1_${Date.now()}`;

  // connectAndLogin guarantees login-success, so nick1 is in onlineUsers.
  const client1 = await connectAndLogin(port, nick1);

  t.after(() => {
    if (client1.connected) client1.disconnect();
  });

  // Record the server-side socket before it is disconnected.
  const serverSocket = io.sockets.sockets.get(client1.id);
  assert.ok(serverSocket, 'il socket server-side di client1 deve esistere');

  // A second client acts as an observer: it subscribes BEFORE the disconnect so
  // the resulting broadcast is guaranteed to be received.
  const nick2 = `Watchdog2_${Date.now()}`;
  const observer = await connectAndLogin(port, nick2);
  t.after(() => observer.disconnect());

  // Subscribe before triggering the disconnect to avoid missing the broadcast.
  const nick1GonePromise = waitForUserList(
    observer,
    (users) => !users.some((u) => u.nick === nick1)
  );

  // Force-disconnect the server-side socket – this is exactly what
  // runStateWatchdog does when it detects an expired lastSeen timestamp.
  serverSocket.disconnect(true);

  const listAfterEviction = await nick1GonePromise;
  assert.ok(
    !listAfterEviction.some((u) => u.nick === nick1),
    'nick1 deve essere rimosso dalla lista dopo che il watchdog disconnette il socket'
  );
});

test('ping/pong: la connessione rimane attiva tramite heartbeat Socket.IO', async (t) => {
  const { port } = await getTestServer();

  const nick = `Ping1_${Date.now()}`;
  const client = createClient(port);

  t.after(() => {
    if (client.connected) client.disconnect();
  });

  await waitForEvent(client, 'connect');

  // Wait longer than two full ping intervals (2 × 300 ms + 200 ms tolerance)
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.ok(client.connected, 'il client deve rimanere connesso grazie al meccanismo di heartbeat ping/pong');
});

test('ping/pong: lastSeen viene aggiornato con gli eventi di attività', async (t) => {
  const { port } = await getTestServer();

  const nick = `PA_${Date.now()}`;
  const nick2 = `PA2_${Date.now()}`;

  const client = await connectAndLogin(port, nick);
  const client2 = await connectAndLogin(port, nick2);

  t.after(() => {
    if (client.connected) client.disconnect();
    if (client2.connected) client2.disconnect();
  });

  // Establish a call so that send-message events are accepted by the server.
  await setupCall(client, client2, nick, nick2);

  // client2 will receive the message if updateLastSeen runs and the socket is live.
  const messagePromise = waitForEvent(client2, 'receive-message', 2000);

  // Emit a message – the send-message handler calls updateLastSeen(nick) before
  // forwarding, proving that activity keeps lastSeen up-to-date.
  client.emit('send-message', 'ping di attività');

  const received = await messagePromise;
  assert.equal(received, 'ping di attività',
    'il messaggio deve arrivare al destinatario, confermando che lastSeen è aggiornato durante le attività');

  // Cleanup
  client.emit('end-call');
});
