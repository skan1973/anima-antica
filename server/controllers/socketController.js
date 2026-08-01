const crypto = require('node:crypto');
const { writeLog, captureError } = require('../logger');
const { User } = require('../db');
const stateService = require('../services/stateService');
const { messageSchema } = require('../schemas/messageSchema');
const { userLoginSchema } = require('../schemas/userLoginSchema');
const { callRequestSchema } = require('../schemas/callSchema');
const { validateSocketEvent } = require('../middleware/socketValidator');

const onlineUsers = {};
const roomMembers = new Map();
const blockedCallersByNick = new Map();
const pendingIncomingCalls = new Map();
const activePeerSessions = new Map();
const sidToNick = new Map();
const PEER_SESSION_TTL_MS = 120000;
const HEARTBEAT_TIMEOUT_MS = 60000;
const HEARTBEAT_WATCHDOG_INTERVAL_MS = 15000;

const updateLastSeen = (nick) => {
  if (onlineUsers[nick]) {
    onlineUsers[nick].lastSeen = Date.now();
  }
};

const setOnlineUserStatus = (nick, status) => {
  if (nick && onlineUsers[nick]) {
    onlineUsers[nick].status = status;
  }
};

const releaseUsersForSession = async (participantNicks) => {
  const uniqueNicks = Array.from(new Set((participantNicks || []).filter(Boolean)));

  await Promise.all(uniqueNicks.map(async (nick) => {
    try {
      await stateService.releaseUser(nick);
    } catch (error) {
      captureError('state.release_user_failed', error, { nick });
    }
  }));

  uniqueNicks.forEach((nick) => setOnlineUserStatus(nick, stateService.STATUS_FREE));
};

const persistLastSeen = async (nick, heartbeatAt = Date.now()) => {
  const timestamp = Number.isFinite(heartbeatAt) ? heartbeatAt : Date.now();
  const lastSeen = new Date(timestamp);

  if (!nick || Number.isNaN(lastSeen.getTime())) {
    return false;
  }

  updateLastSeen(nick);

  try {
    await User.updateOne({ nick }, { $set: { lastSeen } });
    return true;
  } catch (error) {
    captureError('watchdog.last_seen.update_failed', error, { nick });
    return false;
  }
};

const buildPeerId = () => {
  return `peer${crypto.randomUUID().replace(/-/g, '')}`;
};

const getNickBySocketId = (socketId) => {
  return Object.keys(onlineUsers).find(nick => onlineUsers[nick]?.socketID === socketId);
};

const sanitizeCountryCode = (value) => {
  const upper = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : 'UN';
};

const getPublicUsers = () => {
  return Object.entries(onlineUsers).map(([nick, user]) => ({
    nick,
    countryCode: user.countryCode || 'UN',
    snapshot: user.snapshot || null,
    snapshotAt: user.snapshotAt || null
  }));
};

const broadcastUsers = (io) => {
  io.emit('update_user_list', getPublicUsers());
};

const isBlocked = (targetNick, callerNick) => {
  const blocked = blockedCallersByNick.get(targetNick);
  return blocked ? blocked.has(callerNick) : false;
};

const blockCallerForTarget = (targetNick, callerNick) => {
  const blocked = blockedCallersByNick.get(targetNick) || new Set();
  blocked.add(callerNick);
  blockedCallersByNick.set(targetNick, blocked);
};

const isLoggedIn = (socketId) => Boolean(getNickBySocketId(socketId));

const hasActiveCallSessionForNick = (nick) => {
  if (!nick) return false;

  for (const session of activePeerSessions.values()) {
    if (session.participantNicks.has(nick)) {
      return true;
    }
  }

  return false;
};

const getSocketSid = (socket) => {
  return typeof socket?.data?.auth?.sid === 'string' ? socket.data.auth.sid : '';
};

const isSocketIdentityBound = (socket) => {
  const sid = getSocketSid(socket);
  if (!sid) return false;
  const nick = getNickBySocketId(socket.id);
  if (!nick) return false;
  return sidToNick.get(sid) === nick;
};

const createCallToken = () => crypto.randomBytes(24).toString('hex');

const createPeerSession = (roomId, participantNicks) => {
  const participantMap = new Map();
  participantNicks.forEach((nick) => participantMap.set(nick, null));

  activePeerSessions.set(roomId, {
    token: createCallToken(),
    participantNicks: new Set(participantNicks),
    participantSockets: participantMap,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  });
  return activePeerSessions.get(roomId);
};

const deletePeerSession = (roomId) => {
  activePeerSessions.delete(roomId);
};

const touchPeerSession = (roomId) => {
  const session = activePeerSessions.get(roomId);
  if (!session) return;
  session.lastActiveAt = Date.now();
};

const ensureRoomMemberSet = (roomId) => {
  const existing = roomMembers.get(roomId);
  if (existing instanceof Set) return existing;
  const created = new Set();
  roomMembers.set(roomId, created);
  return created;
};

const attachSocketToSession = (socket, roomId, nick) => {
  const session = activePeerSessions.get(roomId);
  if (!session) return false;
  if (!session.participantNicks.has(nick)) return false;

  const members = ensureRoomMemberSet(roomId);
  members.add(socket.id);
  socket.join(roomId);
  socket.roomId = roomId;
  session.participantSockets.set(nick, socket.id);
  touchPeerSession(roomId);
  return true;
};

const detachSocketFromSession = (socket) => {
  if (!socket.roomId) return;

  const roomId = socket.roomId;
  const members = roomMembers.get(roomId);
  if (members instanceof Set) {
    members.delete(socket.id);
    if (members.size === 0) {
      roomMembers.delete(roomId);
    }
  }

  const session = activePeerSessions.get(roomId);
  if (session) {
    for (const [nick, sid] of session.participantSockets.entries()) {
      if (sid === socket.id) {
        session.participantSockets.set(nick, null);
      }
    }
    touchPeerSession(roomId);
  }

  socket.leave(roomId);
  socket.roomId = null;
};

const emitPrivateSessionReady = (io, roomId) => {
  const session = activePeerSessions.get(roomId);
  if (!session) return;

  const participants = [];
  for (const nick of session.participantNicks) {
    const user = onlineUsers[nick];
    const sid = session.participantSockets.get(nick);
    if (!user || !sid) return;
    participants.push({ nick, peerId: user.peerId, socketId: sid });
  }

  io.to(roomId).emit('private-session-ready', {
    roomId,
    callToken: session.token,
    participants
  });
};

const cleanupExpiredPeerSessions = () => {
  const now = Date.now();
  for (const [roomId, session] of activePeerSessions.entries()) {
    const idleMs = now - (session.lastActiveAt || session.createdAt);
    const hasConnectedParticipants = Array.from(session.participantSockets.values()).some(Boolean);
    if (!hasConnectedParticipants && idleMs > PEER_SESSION_TTL_MS) {
      activePeerSessions.delete(roomId);
      roomMembers.delete(roomId);
    }
  }
};

setInterval(cleanupExpiredPeerSessions, 30000).unref();

const isSocketInAuthorizedRoom = (socket, roomId) => {
  if (!roomId || typeof roomId !== 'string') return false;
  if (socket.roomId !== roomId) return false;

  const members = roomMembers.get(roomId);
  if (!(members instanceof Set)) return false;
  return members.has(socket.id);
};

const canSocketOperateRoom = (socket, roomId) => {
  if (!isSocketIdentityBound(socket)) return false;
  return isSocketInAuthorizedRoom(socket, roomId);
};

const leaveRoom = async (socket, io) => {
  if (!socket.roomId) return;

  const roomId = socket.roomId;
  if (!isSocketInAuthorizedRoom(socket, roomId)) {
    writeLog('warn', 'socket.leave_room.unauthorized_attempt', {
      socketId: socket.id,
      roomId
    });
    socket.roomId = null;
    return;
  }

  socket.to(roomId).emit('call-ended', 'La chiamata è terminata.');

  const session = activePeerSessions.get(roomId);
  if (session) {
    await releaseUsersForSession(Array.from(session.participantNicks));
  }

  const participants = roomMembers.get(roomId);
  const participantSocketIds = participants instanceof Set ? Array.from(participants) : [];

  participantSocketIds.forEach((sid) => {
    const participantSocket = io.sockets.sockets.get(sid);
    if (participantSocket) {
      participantSocket.leave(roomId);
      participantSocket.roomId = null;
    }
  });

  roomMembers.delete(roomId);
  deletePeerSession(roomId);
  socket.leave(roomId);

  socket.roomId = null;
  broadcastUsers(io);
};

const runStateWatchdog = async (io) => {
  const now = Date.now();
  const INACTIVITY_THRESHOLD = HEARTBEAT_TIMEOUT_MS;

  for (const nick in onlineUsers) {
    const user = onlineUsers[nick];
    if (user.lastSeen && (now - user.lastSeen > INACTIVITY_THRESHOLD)) {
      writeLog('warn', 'watchdog.user_timeout', { nick });
      const socket = io.sockets.sockets.get(user.socketID);
      const roomId = socket?.roomId;
      const session = roomId ? activePeerSessions.get(roomId) : null;
      const participantNicks = session ? Array.from(session.participantNicks) : [nick];

      await releaseUsersForSession(participantNicks);

      if (session && roomId) {
        socket.to(roomId).emit('call-ended', 'La chiamata è terminata per inattività.');
        roomMembers.delete(roomId);
        deletePeerSession(roomId);
      }

      if (socket) {
        socket.disconnect(true);
      } else {
        delete onlineUsers[nick];
        broadcastUsers(io);
      }
    }
  }
};

function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = (io, options = {}) => {
  const onSocketDisconnect = typeof options.onSocketDisconnect === 'function'
    ? options.onSocketDisconnect
    : () => {};
  const handleReconnectState = typeof options.handleReconnectState === 'function'
    ? options.handleReconnectState
    : ({ nick }) => stateService.restoreUserStateAfterReconnect({ nick, activeSessions: activePeerSessions });

  setInterval(() => runStateWatchdog(io), HEARTBEAT_WATCHDOG_INTERVAL_MS).unref();

  io.on('connection', (socket) => {
    writeLog('info', 'socket.connected', { socketId: socket.id });

    socket.on('ping', async () => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;

      const nick = getNickBySocketId(socket.id);
      const heartbeatAt = Date.now();
      if (nick) {
        await persistLastSeen(nick, heartbeatAt);
      }

      socket.emit('pong', {
        ok: true,
        lastHeartbeatAt: heartbeatAt
      });
    });

    socket.on('user_login', async (payload) => {
      const normalizedPayload = typeof payload === 'string' ? { nick: payload } : payload;
      const parsed = userLoginSchema.safeParse(normalizedPayload);

      if (!parsed.success) {
        socket.emit('login-error', 'Nickname non valido. Usa 3-24 caratteri: lettere, numeri, punto, underscore o trattino.');
        return;
      }

      const sanitizedNick = sanitize(parsed.data.nick);
      const countryCode = sanitizeCountryCode(parsed.data.countryCode);

      if (!sanitizedNick) {
        socket.emit('login-error', 'Il nickname non può essere vuoto.');
        return;
      }

      if (onlineUsers[sanitizedNick]) {
        const existingSocketId = onlineUsers[sanitizedNick].socketID;
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (!existingSocket) {
          delete onlineUsers[sanitizedNick];
        } else {
          socket.emit('login-error', 'Questo nickname è già in uso.');
          return;
        }
      }

      try {
        await handleReconnectState({ nick: sanitizedNick });

        socket.userId = 'user-' + Date.now() + Math.random();
        const peerId = buildPeerId(socket.id);

        const sid = getSocketSid(socket);
        if (!sid) {
          socket.emit('login-error', 'Sessione autenticazione non valida.');
          return;
        }

        const alreadyBoundNick = sidToNick.get(sid);
        if (alreadyBoundNick && alreadyBoundNick !== sanitizedNick) {
          socket.emit('login-error', 'Token sessione già associato a un altro utente.');
          return;
        }

        const reconnectResult = await handleReconnectState({ nick: sanitizedNick });

        onlineUsers[sanitizedNick] = {
          socketID: socket.id,
          status: reconnectResult.user?.status || stateService.STATUS_FREE,
          peerId,
          countryCode,
          snapshot: null,
          snapshotAt: null,
          lastSeen: Date.now()
        };
        sidToNick.set(sid, sanitizedNick);

        await persistLastSeen(sanitizedNick);

        if (reconnectResult.reason === 'RECOVERED_TO_FREE') {
          writeLog('info', 'state.reconnect.released_stale_busy', {
            nick: sanitizedNick,
            socketId: socket.id
          });
        }

        socket.emit('login-success', {
          peerId
        });

        broadcastUsers(io);
      } catch (err) {
        if (err?.code === 'RECONNECT_IN_PROGRESS') {
          socket.emit('login-error', 'Riconnessione già in corso per questo utente.');
          return;
        }
        captureError('socket.login.error', err, { socketId: socket.id });
        socket.emit('login-error', 'Errore interno del server.');
      }
    });

    socket.on('disconnect', async () => {
      const roomIdBeforeDetach = socket.roomId;
      const sessionBeforeDetach = roomIdBeforeDetach ? activePeerSessions.get(roomIdBeforeDetach) : null;
      detachSocketFromSession(socket);
      const nick = getNickBySocketId(socket.id);
      const sid = getSocketSid(socket);
      pendingIncomingCalls.delete(socket.id);
      pendingIncomingCalls.forEach((callerSocketId, calleeSocketId) => {
        if (callerSocketId === socket.id) pendingIncomingCalls.delete(calleeSocketId);
      });

      if (sessionBeforeDetach?.participantNicks) {
        await releaseUsersForSession(Array.from(sessionBeforeDetach.participantNicks));
        if (roomIdBeforeDetach) {
          socket.to(roomIdBeforeDetach).emit('call-ended', 'La chiamata è terminata.');
          roomMembers.delete(roomIdBeforeDetach);
          deletePeerSession(roomIdBeforeDetach);
        }
      } else if (nick) {
        await releaseUsersForSession([nick]);
      }

      if (nick) {
        delete onlineUsers[nick];
        blockedCallersByNick.delete(nick);
        blockedCallersByNick.forEach((set) => set.delete(nick));
      }
      if (sid && sidToNick.get(sid) === nick) {
        sidToNick.delete(sid);
      }
      onSocketDisconnect(socket);
      broadcastUsers(io);
    });

    socket.on('call-request', async ({ targetNick }) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) {
        socket.emit('call-feedback', 'Utente non autenticato.');
        return;
      }

      const sanitizedTargetNick = sanitize(targetNick);
      const callerNick = getNickBySocketId(socket.id);

      if (!callerNick) {
        socket.emit('call-feedback', 'Impossibile identificare il chiamante.');
        return;
      }

      if (callerNick === sanitizedTargetNick) {
        socket.emit('call-feedback', 'Non puoi chiamare te stesso.');
        return;
      }

      const target = onlineUsers[sanitizedTargetNick];
      if (!target || target.status !== 'libero') {
        socket.emit('call-feedback', 'Utente occupato o non trovato');
        return;
      }

      if (isBlocked(sanitizedTargetNick, callerNick)) {
        socket.emit('call-feedback', 'Non puoi chiamare questo utente: sei stato bloccato.');
        return;
      }

      io.to(target.socketID).emit('incoming-call', {
        callerNick: sanitize(callerNick),
        callerSocketId: socket.id,
        callerPeerId: onlineUsers[callerNick].peerId
      });
      pendingIncomingCalls.set(target.socketID, socket.id);
    });

    socket.on('accept-call', async ({ callerSocketId }) => {
      if (!callerSocketId || !isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;

      if (pendingIncomingCalls.get(socket.id) !== callerSocketId) {
        socket.emit('call-feedback', 'Richiesta chiamata non valida o scaduta.');
        return;
      }
      pendingIncomingCalls.delete(socket.id);

      const receiverNick = getNickBySocketId(socket.id);
      const callerNick = getNickBySocketId(callerSocketId);
      if (!receiverNick || !callerNick) {
        socket.emit('call-feedback', 'Impossibile avviare la sessione privata.');
        return;
      }

      const callerSocket = io.sockets.sockets.get(callerSocketId);
      if (!callerSocket) return;

      if (!isLoggedIn(callerSocket.id) || !isSocketIdentityBound(callerSocket)) {
        socket.emit('call-feedback', 'Il chiamante non è più autorizzato.');
        return;
      }

      const reservation = await stateService.reserveUsers(callerNick, receiverNick);
      if (!reservation.ok) {
        socket.emit('call-feedback', 'Utente occupato o richiesta in conflitto.');
        io.to(callerSocketId).emit('call-feedback', 'Utente occupato o richiesta in conflitto.');
        return;
      }

      const roomId = `room-${crypto.randomUUID()}`;
      const peerSession = createPeerSession(roomId, [callerNick, receiverNick]);
      attachSocketToSession(socket, roomId, receiverNick);

      attachSocketToSession(callerSocket, roomId, callerNick);

      setOnlineUserStatus(callerNick, stateService.STATUS_BUSY);
      setOnlineUserStatus(receiverNick, stateService.STATUS_BUSY);
      broadcastUsers(io);

      const callerPeerId = callerNick ? onlineUsers[callerNick]?.peerId : null;
      const receiverPeerId = receiverNick ? onlineUsers[receiverNick]?.peerId : null;

      io.to(callerSocketId).emit('call-accepted', {
        receiverSocketId: socket.id,
        receiverPeerId,
        roomId,
        callToken: peerSession.token
      });
      socket.emit('call-accepted', {
        receiverSocketId: callerSocketId,
        receiverPeerId: callerPeerId,
        roomId,
        callToken: peerSession.token
      });

      emitPrivateSessionReady(io, roomId);
    });

    socket.on('resume-call-session', ({ roomId, callToken }) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) {
        socket.emit('resume-call-result', { ok: false, reason: 'NOT_LOGGED_IN' });
        return;
      }

      if (typeof roomId !== 'string' || typeof callToken !== 'string') {
        socket.emit('resume-call-result', { ok: false, reason: 'INVALID_PAYLOAD' });
        return;
      }

      const session = activePeerSessions.get(roomId);
      if (!session) {
        socket.emit('resume-call-result', { ok: false, reason: 'SESSION_NOT_FOUND' });
        return;
      }

      if (session.token !== callToken) {
        socket.emit('resume-call-result', { ok: false, reason: 'TOKEN_MISMATCH' });
        return;
      }

      const nick = getNickBySocketId(socket.id);
      if (!nick || !session.participantNicks.has(nick)) {
        socket.emit('resume-call-result', { ok: false, reason: 'NOT_PARTICIPANT' });
        return;
      }

      const attached = attachSocketToSession(socket, roomId, nick);
      if (!attached) {
        socket.emit('resume-call-result', { ok: false, reason: 'ATTACH_FAILED' });
        return;
      }

      setOnlineUserStatus(nick, stateService.STATUS_BUSY);

      socket.emit('resume-call-result', { ok: true });
      emitPrivateSessionReady(io, roomId);
      broadcastUsers(io);
    });

    socket.on('end-call', async () => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;

      if (socket.roomId && !canSocketOperateRoom(socket, socket.roomId)) {
        writeLog('warn', 'socket.end_call.unauthorized_room_access', {
          socketId: socket.id,
          roomId: socket.roomId
        });
        return;
      }

      await leaveRoom(socket, io);
    });

    socket.on('deny-call', ({ callerSocketId }) => {
      if (!callerSocketId || !isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;

      if (pendingIncomingCalls.get(socket.id) !== callerSocketId) {
        socket.emit('call-feedback', 'Richiesta chiamata non valida o scaduta.');
        return;
      }
      pendingIncomingCalls.delete(socket.id);

      const calleeNick = getNickBySocketId(socket.id);
      const callerNick = getNickBySocketId(callerSocketId);
      if (!calleeNick || !callerNick) return;

      io.to(callerSocketId).emit('call-feedback', `${sanitize(calleeNick)} ha rifiutato la chiamata.`);
    });

    socket.on('block-caller', ({ callerSocketId }) => {
      if (!callerSocketId || !isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;

      if (pendingIncomingCalls.get(socket.id) !== callerSocketId) {
        socket.emit('call-feedback', 'Richiesta chiamata non valida o scaduta.');
        return;
      }
      pendingIncomingCalls.delete(socket.id);

      const calleeNick = getNickBySocketId(socket.id);
      const callerNick = getNickBySocketId(callerSocketId);
      if (!calleeNick || !callerNick) return;

      blockCallerForTarget(calleeNick, callerNick);
      io.to(callerSocketId).emit('call-feedback', `${sanitize(calleeNick)} ti ha bloccato definitivamente.`);
      socket.emit('call-feedback', `Hai bloccato definitivamente ${sanitize(callerNick)}.`);
    });

    socket.on('user-snapshot', ({ imageDataUrl, timestamp }) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;
      const nick = getNickBySocketId(socket.id);
      if (!nick || !onlineUsers[nick]) return;

      if (typeof imageDataUrl !== 'string') return;
      if (!imageDataUrl.startsWith('data:image/')) return;
      if (imageDataUrl.length > 800000) {
        writeLog('warn', 'socket.snapshot.too_large', {
          nick,
          socketId: socket.id,
          length: imageDataUrl.length
        });
        return;
      }

      onlineUsers[nick].snapshot = imageDataUrl;
      onlineUsers[nick].snapshotAt = Number.isFinite(timestamp) ? timestamp : Date.now();
      broadcastUsers(io);
    });

    socket.on('send-message', (msg) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;
      const nick = getNickBySocketId(socket.id);
      updateLastSeen(nick);
      const result = messageSchema.safeParse(msg);
      if (!result.success) {
        writeLog('warn', 'socket.message.invalid_schema', {
          socketId: socket.id,
          issues: result.error.issues
        });
        return;
      }

      if (!socket.roomId) {
        writeLog('warn', 'socket.message.rejected_no_room', {
          socketId: socket.id
        });
        return;
      }

      if (!canSocketOperateRoom(socket, socket.roomId)) {
        writeLog('warn', 'socket.message.unauthorized_room_access', {
          socketId: socket.id,
          roomId: socket.roomId
        });
        return;
      }

      const cleanMsg = sanitize(result.data);
      socket.to(socket.roomId).emit('receive-message', cleanMsg);
    });

    socket.on('signal', ({ roomId, signalData }) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) return;
      const nick = getNickBySocketId(socket.id);
      updateLastSeen(nick);
      if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) {
        writeLog('warn', 'socket.signal.unauthorized_room', {
          socketId: socket.id,
          roomId
        });
        return;
      }

      if (!canSocketOperateRoom(socket, roomId)) {
        writeLog('warn', 'socket.signal.unauthorized_membership', {
          socketId: socket.id,
          roomId
        });
        return;
      }

      const peerSession = activePeerSessions.get(roomId);
<<<<<<< HEAD
      const currentNick = getNickBySocketId(socket.id);
      const isParticipant = Boolean(currentNick && peerSession?.participantNicks?.has(currentNick));
=======
      const isParticipant = Boolean(nick && peerSession?.participantNicks?.has(nick));
>>>>>>> 252fc3b3a0cb7cee630cba457c2ad1628d0ed08a
      if (!peerSession || !isParticipant) {
        writeLog('warn', 'socket.signal.outside_authorized_session', {
          socketId: socket.id,
          roomId
        });
        return;
      }

      touchPeerSession(roomId);

      socket.to(roomId).emit('signal', {
        senderSocketId: socket.id,
        signalData
      });
    });

    socket.on('validate-peer-call', ({ roomId, callToken }) => {
      if (!isLoggedIn(socket.id) || !isSocketIdentityBound(socket)) {
        socket.emit('peer-call-validation', { ok: false, reason: 'NOT_LOGGED_IN' });
        return;
      }

      if (typeof roomId !== 'string' || typeof callToken !== 'string') {
        socket.emit('peer-call-validation', { ok: false, reason: 'INVALID_PAYLOAD' });
        return;
      }

      const peerSession = activePeerSessions.get(roomId);
      if (!peerSession) {
        socket.emit('peer-call-validation', { ok: false, reason: 'SESSION_NOT_FOUND' });
        return;
      }

      const nick = getNickBySocketId(socket.id);
      const isAuthorized = Boolean(
        nick &&
        peerSession.token === callToken &&
        peerSession.participantNicks.has(nick)
      );
      socket.emit('peer-call-validation', {
        ok: isAuthorized,
        reason: isAuthorized ? 'OK' : 'UNAUTHORIZED'
      });
    });
  });
};
