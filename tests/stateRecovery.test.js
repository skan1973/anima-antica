const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { Server } = require('socket.io');
const { io: createClient } = require('socket.io-client');

const socketController = require('../server/controllers/socketController');
const {
  cleanupBusyUsersOnStartup,
  restoreUserStateAfterReconnect,
  resetReconnectGuardsForTests
} = require('../server/services/stateService');

const waitForEvent = (socket, eventName) => {
  return new Promise((resolve) => {
    socket.once(eventName, (payload) => resolve({ eventName, payload }));
  });
};

const waitForLoginOutcome = (socket) => {
  return Promise.race([
    waitForEvent(socket, 'login-success'),
    waitForEvent(socket, 'login-error')
  ]);
};

const createSocketHarness = async (handleReconnectState) => {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  io.use((socket, next) => {
    socket.data.auth = {
      sid: typeof socket.handshake.auth?.sid === 'string'
        ? socket.handshake.auth.sid
        : `sid-${socket.id}`
    };
    next();
  });

  socketController(io, { handleReconnectState });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();

  return {
    io,
    httpServer,
    url: `http://127.0.0.1:${port}`
  };
};

test('restoreUserStateAfterReconnect frees a stale busy user without an active call', async (t) => {
  resetReconnectGuardsForTests();

  let capturedFindOneQuery;
  let capturedUpdateQuery;
  let capturedUpdatePayload;
  let capturedUpdateOptions;

  const userModel = {
    findOne: async (query) => {
      capturedFindOneQuery = query;
      return { nick: query.nick, status: 'occupato' };
    },
    findOneAndUpdate: async (query, update, options) => {
      capturedUpdateQuery = query;
      capturedUpdatePayload = update;
      capturedUpdateOptions = options;
      return { nick: query.nick, status: 'libero' };
    }
  };

  const result = await restoreUserStateAfterReconnect({
    nick: 'utente-test',
    userModel,
    activeSessions: new Map()
  });

  assert.deepEqual(capturedFindOneQuery, { nick: 'utente-test' });
  assert.deepEqual(capturedUpdateQuery, { nick: 'utente-test', status: 'occupato' });
  assert.deepEqual(capturedUpdatePayload, { status: 'libero' });
  assert.equal(capturedUpdateOptions.new, true);
  assert.equal(capturedUpdateOptions.runValidators, true);
  assert.equal(result.recovered, true);
  assert.equal(result.reason, 'RECOVERED_TO_FREE');
});

test('cleanupBusyUsersOnStartup resets busy users to free on server startup', async () => {
  let capturedQuery;
  let capturedUpdate;
  let capturedOptions;

  const userModel = {
    updateMany: async (query, update, options) => {
      capturedQuery = query;
      capturedUpdate = update;
      capturedOptions = options;
      return { matchedCount: 3, modifiedCount: 3 };
    }
  };

  const result = await cleanupBusyUsersOnStartup({ userModel });

  assert.deepEqual(capturedQuery, { status: 'occupato' });
  assert.deepEqual(capturedUpdate, { status: 'libero' });
  assert.deepEqual(capturedOptions, { runValidators: true });
  assert.deepEqual(result, { matchedCount: 3, modifiedCount: 3 });
});

test('restoreUserStateAfterReconnect rejects a concurrent reconnect for the same user', async () => {
  resetReconnectGuardsForTests();

  let openFirstLookup;
  let signalFirstLookupStarted;
  const firstLookupStarted = new Promise((resolve) => {
    signalFirstLookupStarted = resolve;
  });
  const firstLookupGate = new Promise((resolve) => {
    openFirstLookup = resolve;
  });
  let lookupCount = 0;

  const userModel = {
    findOne: async ({ nick }) => {
      lookupCount += 1;
      if (lookupCount === 1) {
        signalFirstLookupStarted();
        await firstLookupGate;
      }
      return { nick, status: 'occupato' };
    },
    findOneAndUpdate: async ({ nick }) => ({ nick, status: 'libero' })
  };

  const firstReconnect = restoreUserStateAfterReconnect({
    nick: 'utente-race',
    userModel,
    activeSessions: new Map()
  });

  await firstLookupStarted;

  const secondReconnect = restoreUserStateAfterReconnect({
    nick: 'utente-race',
    userModel,
    activeSessions: new Map()
  });

  openFirstLookup();

  const [firstResult, secondResult] = await Promise.allSettled([
    firstReconnect,
    secondReconnect
  ]);

  assert.equal(firstResult.status, 'fulfilled');
  assert.equal(firstResult.value.recovered, true);
  assert.equal(secondResult.status, 'rejected');
  assert.equal(secondResult.reason.code, 'RECONNECT_IN_PROGRESS');
});

test('simultaneous reconnects for the same user allow only one login', async (t) => {
  resetReconnectGuardsForTests();

  let openFirstLookup;
  let signalFirstLookupStarted;
  const firstLookupStarted = new Promise((resolve) => {
    signalFirstLookupStarted = resolve;
  });
  const firstLookupGate = new Promise((resolve) => {
    openFirstLookup = resolve;
  });
  let lookupCount = 0;

  const userModel = {
    findOne: async ({ nick }) => {
      lookupCount += 1;
      if (lookupCount === 1) {
        signalFirstLookupStarted();
        await firstLookupGate;
      }
      return { nick, status: 'occupato' };
    },
    findOneAndUpdate: async ({ nick }) => ({ nick, status: 'libero' })
  };

  const harness = await createSocketHarness(({ nick }) => {
    return restoreUserStateAfterReconnect({
      nick,
      userModel,
      activeSessions: new Map()
    });
  });

  t.after(async () => {
    harness.io.close();
    await new Promise((resolve, reject) => {
      harness.httpServer.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const clientOne = createClient(harness.url, {
    auth: { sid: 'shared-session-id' },
    transports: ['websocket']
  });
  const clientTwo = createClient(harness.url, {
    auth: { sid: 'shared-session-id' },
    transports: ['websocket']
  });

  t.after(() => {
    clientOne.close();
    clientTwo.close();
  });

  await Promise.all([
    waitForEvent(clientOne, 'connect'),
    waitForEvent(clientTwo, 'connect')
  ]);

  const firstOutcome = waitForLoginOutcome(clientOne);
  const secondOutcome = waitForLoginOutcome(clientTwo);

  clientOne.emit('user_login', { nick: 'utente-race', countryCode: 'IT' });
  await firstLookupStarted;
  clientTwo.emit('user_login', { nick: 'utente-race', countryCode: 'IT' });

  await new Promise((resolve) => setImmediate(resolve));
  openFirstLookup();

  const [firstResult, secondResult] = await Promise.all([firstOutcome, secondOutcome]);

  assert.equal(firstResult.eventName, 'login-success');
  assert.equal(secondResult.eventName, 'login-error');
  assert.ok(
    [
      'Riconnessione già in corso per questo utente.',
      'Questo nickname è già in uso.'
    ].includes(secondResult.payload)
  );
});
