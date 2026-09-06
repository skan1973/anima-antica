// server/controllers/socketController.js
const crypto = require('node:crypto');
const { writeLog, captureError } = require('../logger');
const { User } = require('../db');
const stateService = require('../services/stateService');
const { messageSchema } = require('../schemas/messageSchema');
const { userLoginSchema } = require('../schemas/userLoginSchema');
const { callRequestSchema } = require('../schemas/callSchema');
const { userSnapshotSchema, signalSchema } = require('../schemas/socketEventsSchema');
const { getTokenRecord, setTokenRecord } = require('../tokenRegistry');
const { pubClient, isRedisReady, scanKeys } = require('../redis');

// ============================================================
// FALLBACK IN-MEMORY (usato quando Redis non è disponibile)
// ============================================================
const onlineUsers = {};
const roomMembers = new Map();
const activePeerSessions = new Map();

// ============================================================
// REDIS CONFIGURAZIONE (Punto 7 - Disegnare modello Redis)
// ============================================================
const REDIS_PREFIX = 'anima:';
const REDIS_TTL_PRESENCE = 60; // secondi
const REDIS_TTL_ROOM = 120; // secondi
const REDIS_TTL_PEER_SESSION = 120; // secondi

// Helper per costruire chiavi Redis
const redisKey = (type, id) => `${REDIS_PREFIX}${type}:${id}`;

// ============================================================
// FUNZIONI HELPER PER PRESENCE (onlineUsers)
// ============================================================
const presenceSet = async (nick, data) => {
  const key = redisKey('presence', nick);
  if (isRedisReady()) {
    await pubClient.hset(key, data);
    await pubClient.expire(key, REDIS_TTL_PRESENCE);
  } else {
    onlineUsers[nick] = { ...onlineUsers[nick], ...data };
  }
};

const presenceGet = async (nick) => {
  const key = redisKey('presence', nick);
  if (isRedisReady()) {
    const data = await pubClient.hgetall(key);
    return data && Object.keys(data).length ? data : null;
  }
  return onlineUsers[nick] || null;
};

const presenceDelete = async (nick) => {
  const key = redisKey('presence', nick);
  if (isRedisReady()) {
    await pubClient.del(key);
  } else {
    delete onlineUsers[nick];
  }
};

const presenceGetAll = async () => {
  if (isRedisReady()) {
    const keys = await scanKeys(`${REDIS_PREFIX}presence:*`);
    if (!keys.length) return [];
    const multi = pubClient.multi();
    keys.forEach((key) => multi.hgetall(key));
    const results = await multi.exec();
    return results.map((data, index) => {
      const nick = keys[index].replace(`${REDIS_PREFIX}presence:`, '');
      return { nick, ...data };
    }).filter(user => user && Object.keys(user).length);
  }
  return Object.entries(onlineUsers).map(([nick, user]) => ({ nick, ...user }));
};

const presenceGetBySocketId = async (socketId) => {
  const users = await presenceGetAll();
  return users.find(user => user.socketId === socketId)?.nick || null;
};

// ============================================================
// FUNZIONI HELPER PER ROOM MEMBERS
// ============================================================
const roomAddMember = async (roomId, socketId) => {
  const key = redisKey('room', roomId);
  if (isRedisReady()) {
    await pubClient.sadd(key, socketId);
    await pubClient.expire(key, REDIS_TTL_ROOM);
  } else {
    if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Set());
    roomMembers.get(roomId).add(socketId);
  }
};

const roomRemoveMember = async (roomId, socketId) => {
  const key = redisKey('room', roomId);
  if (isRedisReady()) {
    await pubClient.srem(key, socketId);
  } else {
    if (roomMembers.has(roomId)) {
      roomMembers.get(roomId).delete(socketId);
      if (roomMembers.get(roomId).size === 0) roomMembers.delete(roomId);
    }
  }
};

const roomGetMembers = async (roomId) => {
  const key = redisKey('room', roomId);
  if (isRedisReady()) {
    return await pubClient.smembers(key);
  }
  return roomMembers.has(roomId) ? Array.from(roomMembers.get(roomId)) : [];
};

const roomDelete = async (roomId) => {
  const key = redisKey('room', roomId);
  if (isRedisReady()) {
    await pubClient.del(key);
  } else {
    roomMembers.delete(roomId);
  }
};

// ============================================================
// FUNZIONI HELPER PER PEER SESSIONS
// ============================================================
const peerSessionSet = async (roomId, data) => {
  const key = redisKey('peersession', roomId);
  if (isRedisReady()) {
    await pubClient.set(key, JSON.stringify(data), 'EX', REDIS_TTL_PEER_SESSION);
  } else {
    activePeerSessions.set(roomId, data);
  }
};

const peerSessionGet = async (roomId) => {
  const key = redisKey('peersession', roomId);
  if (isRedisReady()) {
    const raw = await pubClient.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  return activePeerSessions.get(roomId) || null;
};

const peerSessionDelete = async (roomId) => {
  const key = redisKey('peersession', roomId);
  if (isRedisReady()) {
    await pubClient.del(key);
  } else {
    activePeerSessions.delete(roomId);
  }
};

const peerSessionTouch = async (roomId) => {
  const key = redisKey('peersession', roomId);
  if (isRedisReady()) {
    await pubClient.expire(key, REDIS_TTL_PEER_SESSION);
  } else {
    const session = activePeerSessions.get(roomId);
    if (session) session.lastActiveAt = Date.now();
  }
};

const peerSessionGetAll = async () => {
  if (isRedisReady()) {
    const keys = await scanKeys(`${REDIS_PREFIX}peersession:*`);
    if (!keys.length) return [];
    const multi = pubClient.multi();
    keys.forEach((key) => multi.get(key));
    const results = await multi.exec();
    return results.map((data, index) => {
      const roomId = keys[index].replace(`${REDIS_PREFIX}peersession:`, '');
      return { roomId, ...JSON.parse(data) };
    }).filter(session => session && session.token);
  }
  return Array.from(activePeerSessions.entries()).map(([roomId, session]) => ({ roomId, ...session }));
};

// ============================================================
// FUNZIONI ESISTENTI ADATTATE (con Redis)
// ============================================================

const blockedCallersByNick = new Map();
const pendingIncomingCalls = new Map();
const sidToNick = new Map();
const PEER_SESSION_TTL_MS = 120000;
const HEARTBEAT_TIMEOUT_MS = 60000;
const HEARTBEAT_WATCHDOG_INTERVAL_MS = 15000;

// ============================================================
// RATE LIMITING - CONFIGURABILE TRAMITE .env
// ============================================================
const SIGNAL_WINDOW_MS = Number.parseInt(process.env.SIGNAL_RATE_WINDOW_MS, 10) || 1000;
const SIGNAL_MAX_REQ = Number.parseInt(process.env.SIGNAL_RATE_MAX_REQ, 10) || 5;
const SNAPSHOT_COOLDOWN_MS = Number.parseInt(process.env.SNAPSHOT_COOLDOWN_MS, 10) || 5000;

// Rate limiting structures
const signalRateLimit = new Map();
const snapshotRateLimit = new Map();

// ============================================================
// FUNZIONI AGGIORNATE
// ============================================================

const updateLastSeen = async (nick) => {
  const user = await presenceGet(nick);
  if (user) {
    user.lastSeen = Date.now();
    await presenceSet(nick, { lastSeen: user.lastSeen });
  }
};

const setOnlineUserStatus = async (nick, status) => {
  const user = await presenceGet(nick);
  if (user) {
    user.status = status;
    await presenceSet(nick, { status });
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

  await Promise.all(uniqueNicks.map(async (nick) => {
    await setOnlineUserStatus(nick, stateService.STATUS_FREE);
  }));
};

const persistLastSeen = async (nick, heartbeatAt = Date.now()) => {
  const timestamp = Number.isFinite(heartbeatAt) ? heartbeatAt : Date.now();
  const lastSeen = new Date(timestamp);

  if (!nick || Number.isNaN(lastSeen.getTime())) {
    return false;
  }

  await updateLastSeen(nick);

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

const getNickBySocketId = async (socketId) => {
  return await presenceGetBySocketId(socketId);
};

const sanitizeCountryCode = (value) => {
  const upper = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : 'UN';
};

const getPublicUsers = async () => {
  const users = await presenceGetAll();
  return users.map((user) => ({
    nick: user.nick,
    countryCode: user.countryCode || 'UN',
    snapshot: user.snapshot || null,
    snapshotAt: user.snapshotAt || null
  }));
};

const broadcastUsers = async (io) => {
  const publicUsers = await getPublicUsers();
  io.emit('update_user_list', publicUsers);
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

const isLoggedIn = async (socketId) => {
  const nick = await getNickBySocketId(socketId);
  return Boolean(nick);
};

const hasActiveCallSessionForNick = async (nick) => {
  if (!nick) return false;
  const sessions = await peerSessionGetAll();
  for (const session of sessions) {
    if (session.participantNicks && session.participantNicks.has && session.participantNicks.has(nick)) {
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

const createPeerSession = async (roomId, participantNicks) => {
  const participantMap = new Map();
  participantNicks.forEach((nick) => participantMap.set(nick, null));

  const sessionData = {
    token: createCallToken(),
    participantNicks: new Set(participantNicks),
    participantSockets: participantMap,
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };

  await peerSessionSet(roomId, sessionData);
  return sessionData;
};

const deletePeerSession = async (roomId) => {
  await peerSessionDelete(roomId);
};

const touchPeerSession = async (roomId) => {
  await peerSessionTouch(roomId);
};

const ensureRoomMemberSet = async (roomId) => {
  // non serve più, usiamo direttamente roomAddMember
};

const attachSocketToSession = async (socket, roomId, nick) => {
  const session = await peerSessionGet(roomId);
  if (!session) return false;
  if (!session.participantNicks.has(nick)) return false;

  await roomAddMember(roomId, socket.id);
  socket.join(roomId);
  socket.roomId = roomId;
  session.participantSockets.set(nick, socket.id);
  await peerSessionSet(roomId, session);
  await touchPeerSession(roomId);
  return true;
};

const detachSocketFromSession = async (socket) => {
  if (!socket.roomId) return;

  const roomId = socket.roomId;
  await roomRemoveMember(roomId, socket.id);

  const session = await peerSessionGet(roomId);
  if (session) {
    for (const [nick, sid] of session.participantSockets.entries()) {
      if (sid === socket.id) {
        session.participantSockets.set(nick, null);
      }
    }
    await peerSessionSet(roomId, session);
    await touchPeerSession(roomId);
  }

  const members = await roomGetMembers(roomId);
  if (members.length === 0) {
    await roomDelete(roomId);
  }

  socket.leave(roomId);
  socket.roomId = null;
};

const emitPrivateSessionReady = async (io, roomId) => {
  const session = await peerSessionGet(roomId);
  if (!session) return;

  const participants = [];
  for (const nick of session.participantNicks) {
    const user = await presenceGet(nick);
    const sid = session.participantSockets.get(nick);
    if (!user || !sid) continue;
    participants.push({ nick, peerId: user.peerId, socketId: sid });
  }

  io.to(roomId).emit('private-session-ready', {
    roomId,
    callToken: session.token,
    participants
  });
};

const cleanupExpiredPeerSessions = async () => {
  const now = Date.now();
  const sessions = await peerSessionGetAll();
  for (const session of sessions) {
    if (session.lastActiveAt && now - session.lastActiveAt > PEER_SESSION_TTL_MS) {
      await peerSessionDelete(session.roomId);
      writeLog('info', 'peer.session.expired', { roomId: session.roomId });
    }
  }
};

setInterval(cleanupExpiredPeerSessions, HEARTBEAT_WATCHDOG_INTERVAL_MS);

const isRateLimited = (rateLimitMap, key, windowMs, maxReq) => {
  const now = Date.now();
  let limits = rateLimitMap.get(key) || { timestamps: [] };
  limits.timestamps = limits.timestamps.filter(t => now - t < windowMs);

  if (limits.timestamps.length >= maxReq) {
    return true;
  }

  limits.timestamps.push(now);
  rateLimitMap.set(key, limits);
  return false;
};

// ============================================================
// GESTIONE FALLBACK REDIS (Punto 8)
// ============================================================
const checkRedisOrFail = (operation) => {
  if (!isRedisReady()) {
    writeLog('warn', 'redis.unavailable.reject_operation', { operation });
    return false;
  }
  return true;
};

module.exports = function(io) {
  io.on('connection', (socket) => {
    // Evento user_login - FAIL-CLOSED se Redis non è disponibile
    socket.on('user_login', async (data) => {
      if (!checkRedisOrFail('user_login')) {
        socket.emit('login-error', 'Servizio momentaneamente non disponibile. Riprova più tardi.');
        return;
      }

      const result = userLoginSchema.safeParse(data);
      if (!result.success) {
        socket.emit('login-error', 'Dati login non validi.');
        return;
      }

      const { nick, countryCode } = result.data;
      // ... resto della logica di login
    });

    socket.on('call-request', async (data) => {
      if (!checkRedisOrFail('call-request')) {
        socket.emit('call-feedback', 'Servizio momentaneamente non disponibile. Riprova più tardi.');
        return;
      }

      const result = callRequestSchema.safeParse(data);
      if (!result.success) {
        socket.emit('call-feedback', 'Richiesta chiamata non valida.');
        return;
      }

      // ... resto della logica di call-request
    });

    socket.on('accept-call', async (data) => {
      if (!checkRedisOrFail('accept-call')) {
        socket.emit('call-feedback', 'Servizio momentaneamente non disponibile. Riprova più tardi.');
        return;
      }

      // ... resto della logica di accept-call
    });

    // ============================================================
    // EVENTI ESISTENTI (GIÀ ADATTATI)
    // ============================================================

    socket.on('user-snapshot', async (data) => {
      const loggedIn = await isLoggedIn(socket.id);
      if (!loggedIn || !isSocketIdentityBound(socket)) return;

      const result = userSnapshotSchema.safeParse(data);
      if (!result.success) {
        writeLog('warn', 'socket.snapshot.invalid_input', { error: result.error });
        return;
      }
      const { imageDataUrl, timestamp } = result.data;

      const nick = await getNickBySocketId(socket.id);
      if (!nick) return;

      const user = await presenceGet(nick);
      if (!user) return;

      if (isRateLimited(snapshotRateLimit, nick, SNAPSHOT_COOLDOWN_MS, 1)) {
        writeLog('warn', 'socket.snapshot.rate_limited', { nick });
        return;
      }

      await presenceSet(nick, {
        snapshot: imageDataUrl,
        snapshotAt: Number.isFinite(timestamp) ? timestamp : Date.now()
      });
      await broadcastUsers(io);
    });

    socket.on('signal', async (data) => {
      const loggedIn = await isLoggedIn(socket.id);
      if (!loggedIn || !isSocketIdentityBound(socket)) return;

      const result = signalSchema.safeParse(data);
      if (!result.success) {
        writeLog('warn', 'socket.signal.invalid_input', { error: result.error });
        return;
      }
      const { roomId, signalData } = result.data;

      if (isRateLimited(signalRateLimit, socket.id, SIGNAL_WINDOW_MS, SIGNAL_MAX_REQ)) {
        writeLog('warn', 'socket.signal.rate_limited', { socketId: socket.id });
        return;
      }

      const nick = await getNickBySocketId(socket.id);
      await updateLastSeen(nick);
      if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) {
        writeLog('warn', 'socket.signal.unauthorized_room', {
          socketId: socket.id,
          roomId
        });
        return;
      }

      const peerSession = await peerSessionGet(roomId);
      const isParticipant = Boolean(nick && peerSession?.participantNicks?.has(nick));
      if (!peerSession || !isParticipant) {
        writeLog('warn', 'socket.signal.outside_authorized_session', {
          socketId: socket.id,
          roomId
        });
        return;
      }

      await touchPeerSession(roomId);
      socket.to(roomId).emit('signal', {
        senderSocketId: socket.id,
        signalData
      });
    });

    socket.on('disconnect', async () => {
      const jti = socket.jti;
      if (!jti) {
        return;
      }

      try {
        const session = await getTokenRecord(jti);
        if (!session) {
          return;
        }

        if (session.activeSocketId === socket.id) {
          session.activeSocketId = null;
          await setTokenRecord(jti, session);

          writeLog('info', 'socket.disconnect.cleanup', {
            socketId: socket.id,
            jti,
            sid: session.sid
          });
        }

        const nick = await getNickBySocketId(socket.id);
        if (nick) {
          await presenceDelete(nick);
          writeLog('info', 'socket.disconnect.presence_removed', { nick });
        }
        if (socket.roomId) {
          await detachSocketFromSession(socket);
        }
      } catch (error) {
        captureError('socket.disconnect.cleanup', error, {
          socketId: socket.id,
          jti
        });
      }
    });
  });
};