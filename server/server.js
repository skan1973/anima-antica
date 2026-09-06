require('dotenv').config();

// server/server.js
// ============================================================
// REQUIRE DEI MODULI
// ============================================================
const express = require('express');
const http = require('http');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { ExpressPeerServer } = require('peer');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createAdapter } = require('@socket.io/redis-adapter');

const socketController = require('./controllers/socketController');
const stateService = require('./services/stateService');
const { validateRequest, schemas } = require('./middleware/validator');
const { writeLog, captureError } = require('./logger');
const sessionService = require('./services/sessionService');
const { socketTokenRevokeSchema } = require('./schemas/authSchema');
const { pubClient, subClient, isRedisReady, redisUrl } = require('./redis');
const { setTokenRecord, getTokenRecord, cleanupSocketTokenRegistry, socketTokenRegistry } = require('./tokenRegistry');
const { connectDB, isDbReady, getDbStatus } = require('./db');
const { jwtSecret } = require('./config');
const tokenInvalidator = require('./services/tokenInvalidator');
const redisService = require('./redis');

// Registrazione callback all'avvio
redisService.registerInvalidateCallback((payload) => {
  tokenInvalidator.handleTokenInvalidate(payload, io);
});

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const ALLOWED_NODE_ENVS = new Set(['development', 'test', 'production']);
const DEFAULT_SOCKET_TOKEN_TTL_SECONDS = 3600;

// ============================================================
// WEBRTC / TURN CONFIGURATION (Punto 12 + Punto 13)
// ============================================================

// TURN Server Configuration (Punto 12)
const TURN_SERVER_1 = process.env.TURN_SERVER_1 || '';
const TURN_SERVER_2 = process.env.TURN_SERVER_2 || '';
const TURN_USERNAME = process.env.TURN_USERNAME || '';
const TURN_CREDENTIAL = process.env.TURN_CREDENTIAL || '';
const TURN_CREDENTIAL_TTL = Number.parseInt(process.env.TURN_CREDENTIAL_TTL, 10) || 86400;

// ICE / WebRTC Tuning (Punto 13)
const ICE_CANDIDATE_POOL_SIZE = Number.parseInt(process.env.ICE_CANDIDATE_POOL_SIZE, 10) || 5;
const ICE_TRANSPORT_POLICY = process.env.ICE_TRANSPORT_POLICY || 'all';
const BUNDLE_POLICY = process.env.BUNDLE_POLICY || 'balanced';
const RTCP_MUX_POLICY = process.env.RTCP_MUX_POLICY || 'require';
const MAX_BITRATE_KBPS = Number.parseInt(process.env.MAX_BITRATE_KBPS, 10) || 500;
const MIN_BITRATE_KBPS = Number.parseInt(process.env.MIN_BITRATE_KBPS, 10) || 100;
const AUDIO_BITRATE_KBPS = Number.parseInt(process.env.AUDIO_BITRATE_KBPS, 10) || 50;

// Credenziali dinamiche per TURN (rotazione)
const getTurnCredential = () => {
  if (!TURN_USERNAME || !TURN_CREDENTIAL) {
    return null;
  }
  return {
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
    ttl: TURN_CREDENTIAL_TTL
  };
};

const getTurnIceServers = () => {
  const servers = [];
  if (TURN_SERVER_1) {
    servers.push({ urls: TURN_SERVER_1 });
  }
  if (TURN_SERVER_2) {
    servers.push({ urls: TURN_SERVER_2 });
  }
  return servers;
};

const getWebRtcConfig = () => {
  return {
    iceCandidatePoolSize: ICE_CANDIDATE_POOL_SIZE,
    iceTransportPolicy: ICE_TRANSPORT_POLICY,
    bundlePolicy: BUNDLE_POLICY,
    rtcpMuxPolicy: RTCP_MUX_POLICY,
    maxBitrateKbps: MAX_BITRATE_KBPS,
    minBitrateKbps: MIN_BITRATE_KBPS,
    audioBitrateKbps: AUDIO_BITRATE_KBPS
  };
};

// ============================================================
// FUNZIONI DI VALIDAZIONE
// ============================================================
const parseClientOrigins = (rawOrigins) => {
  if (typeof rawOrigins !== 'string') return [];
  return rawOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
};

const validateClientOriginsOrExit = (rawOrigins, productionMode) => {
  const configuredOrigins = parseClientOrigins(rawOrigins);
  const origins = configuredOrigins.length > 0 ? configuredOrigins : [...DEFAULT_DEV_ORIGINS];
  const reasons = [];

  if (configuredOrigins.some((origin) => origin === '*')) {
    reasons.push('CLIENT_ORIGIN non può contenere wildcard "*"');
  }

  if (productionMode && configuredOrigins.length === 0) {
    reasons.push('CLIENT_ORIGIN obbligatorio in produzione');
  }

  origins.forEach((origin) => {
    try {
      const parsed = new URL(origin);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        reasons.push(`Protocollo non consentito in CLIENT_ORIGIN: ${origin}`);
      }
    } catch (error) {
      reasons.push(`Origine non valida in CLIENT_ORIGIN: ${origin}`);
    }
  });

  if (reasons.length > 0) {
    writeLog('error', 'config.cors.invalid', {
      reasons,
      advice: 'Imposta CLIENT_ORIGIN come lista di origini esplicite separate da virgola.'
    });
    process.exit(1);
  }

  return new Set(origins);
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const validateNodeEnvOrExit = (value) => {
  const envValue = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const normalized = envValue || 'development';

  if (!ALLOWED_NODE_ENVS.has(normalized)) {
    writeLog('error', 'config.node_env.invalid', {
      provided: value,
      allowed: Array.from(ALLOWED_NODE_ENVS)
    });
    process.exit(1);
  }

  return normalized;
};

const validatePortOrExit = (value, productionMode) => {
  const hasPort = typeof value === 'string' && value.trim().length > 0;

  if (productionMode && !hasPort) {
    writeLog('error', 'config.port.missing', {
      productionMode
    });
    process.exit(1);
  }

  const parsed = hasPort ? Number.parseInt(value, 10) : 3000;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    writeLog('error', 'config.port.invalid', {
      provided: value,
      advice: 'Usa una porta intera nel range 1-65535.'
    });
    process.exit(1);
  }

  return parsed;
};

const createIpRateLimiter = ({ windowMs, maxRequests }) => {
  const requestsByIp = new Map();
  let lastCleanupAt = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    if (now - lastCleanupAt > windowMs * 2) {
      for (const [key, entry] of requestsByIp.entries()) {
        if (now - entry.windowStart >= windowMs) {
          requestsByIp.delete(key);
        }
      }
      lastCleanupAt = now;
    }

    const entry = requestsByIp.get(ip);
    if (!entry || (now - entry.windowStart) >= windowMs) {
      requestsByIp.set(ip, { windowStart: now, count: 1 });
      return next();
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      const retryAfterSec = Math.ceil((windowMs - (now - entry.windowStart)) / 1000);
      res.setHeader('Retry-After', String(Math.max(retryAfterSec, 1)));
      return res.status(429).json({ error: 'Troppe richieste verso endpoint Peer. Riprova più tardi.' });
    }

    return next();
  };
};

const normalizeIp = (value) => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
};

const getRequestClientContext = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const ip = normalizeIp(forwardedIp || req.ip || req.socket?.remoteAddress || 'unknown');
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
  return { ip, userAgent };
};

const getSocketClientContext = (socket) => {
  const forwarded = socket.handshake.headers?.['x-forwarded-for'];
  const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  const ip = normalizeIp(forwardedIp || socket.handshake.address || socket.request?.socket?.remoteAddress || 'unknown');
  const userAgent = typeof socket.handshake.headers?.['user-agent'] === 'string'
    ? socket.handshake.headers['user-agent']
    : '';
  return { ip, userAgent };
};

const buildClientFingerprint = ({ ip, userAgent }) => {
  return crypto
    .createHash('sha256')
    .update(`${ip}|${userAgent}`)
    .digest('hex');
};

const nodeEnv = validateNodeEnvOrExit(process.env.NODE_ENV);
const isProd = nodeEnv === 'production';
const allowedClientOrigins = validateClientOriginsOrExit(process.env.CLIENT_ORIGIN, isProd);
const port = validatePortOrExit(process.env.PORT, isProd);
const socketTokenTtlSeconds = parsePositiveInt(process.env.SOCKET_TOKEN_TTL_SECONDS, DEFAULT_SOCKET_TOKEN_TTL_SECONDS);

const app = express();
app.disable('x-powered-by');
if (isProd) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://unpkg.com'], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'", 'wss:', 'https:'], objectSrc: ["'none'"], frameAncestors: ["'none'"] } }
}));
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// ============================================================
// GATE DB PER LE ROTTE /api - AGGIUNTO PER PROMPT 12
// ============================================================
app.use('/api', (req, res, next) => {
  // Escludi /api/health dal gate (deve rimanere accessibile)
  if (req.path === '/health') {
    return next();
  }

  const dbStatus = getDbStatus();
  if (!dbStatus.ready) {
    writeLog('warn', 'api.gate.db_unavailable', {
      path: req.path,
      ip: req.ip
    });
    return res.status(503).json({
      error: 'Database temporarily unavailable',
      ok: false
    });
  }
  next();
});

// ============================================================
// ============================================================

const checkBan = async (req, res, next) => {
  const ip = req.ip;
  if (!pubClient) {
    return next();
  }

  try {
    const isBanned = await pubClient.get(`ban:${ip}`);
    if (isBanned) {
      return res.status(403).json({ error: 'Accesso temporaneamente sospeso per abuso.' });
    }
  } catch (err) {
    writeLog('warn', 'rate.limiter.ban_check_failed', { error: err.message });
  }
  next();
};

// Crea lo store Redis solo se pubClient è disponibile, altrimenti usa MemoryStore di default (undefined)
// getRateLimitStore non più necessario post-fix


const createAuthRateLimiter = () => {
  const store = pubClient
    ? new RedisStore({ sendCommand: (...args) => pubClient.sendCommand(args) })
    : undefined;
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: store,
    handler: async (req, res) => {
      if (pubClient) {
        try {
          await pubClient.setEx(`ban:${req.ip}`, 3600, 'true');
        } catch (err) {
          writeLog('error', 'rate.limiter.ban_set_failed', { error: err.message });
        }
      }
      res.status(429).json({ error: 'Troppi tentativi. Accesso sospeso temporaneamente.' });
    }
});
};
const authRateLimiter = createAuthRateLimiter();

const fingerprintRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  store: pubClient ? new RedisStore({ sendCommand: (...args) => pubClient.sendCommand(args) }) : undefined,
  keyGenerator: (req) => {
    const { ip, userAgent } = getRequestClientContext(req);
    return buildClientFingerprint({ ip, userAgent });
  },
  handler: async (req, res) => {
    try {
      if (pubClient) await pubClient.setEx(`ban:${req.ip}`, 3600, 'true');
    } catch (err) {
      writeLog('error', 'rate.limiter.ban_set_failed', { error: err.message });
    }
    res.status(429).json({ error: 'Richieste troppo frequenti. Accesso sospeso temporaneamente.' });
  }
});

// ============================================================
// SHARED CORS CONFIGURATION (Fix SCHEDA 003)
// ============================================================
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      if (isProd) {
        writeLog('warn', 'cors.no_origin_prod_denied');
        return callback(new Error('CORS_ORIGIN_REQUIRED'));
      }
      writeLog('warn', 'cors.no_origin_dev', { env: nodeEnv });
      return callback(null, true); // Consenti solo in dev per debugging
    }
    if (allowedClientOrigins.has(origin)) {
      return callback(null, true);
    }
    writeLog('warn', 'cors.denied', { origin, allowed: Array.from(allowedClientOrigins) });
    return callback(new Error('CORS_ORIGIN_DENIED'));
  },
  methods: ['GET', 'POST']
};

const server = http.createServer(app);
const io = new Server(server, {
  cors: corsOptions
});

// Redis setup
if (redisUrl) {
  io.adapter(createAdapter(pubClient, subClient));
  writeLog('info', 'redis.adapter.configured');
}

// ============================================================
// SOCKET.IO AUTH MIDDLEWARE - AGGIUNTO PER PROMPT 8
// ============================================================
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) {
      writeLog('warn', 'socket.auth.missing_token', {
        socketId: socket.id,
        ip: getSocketClientContext(socket).ip
      });
      return next(new Error('Authentication required: token missing'));
    }

    let claims;
    try {
      claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    } catch (jwtError) {
      writeLog('warn', 'socket.auth.invalid_token', {
        socketId: socket.id,
        error: jwtError.message
      });
      return next(new Error('Authentication failed: invalid token'));
    }

    const { sid, jti, fp } = claims;
    if (!sid || !jti || !fp) {
      writeLog('warn', 'socket.auth.missing_claims', {
        socketId: socket.id,
        hasSid: !!sid,
        hasJti: !!jti,
        hasFp: !!fp
      });
      return next(new Error('Authentication failed: missing claims'));
    }

    const session = await getTokenRecord(jti);
    if (!session) {
      writeLog('warn', 'socket.auth.session_not_found', {
        socketId: socket.id,
        jti
      });
      return next(new Error('Authentication failed: session not found'));
    }

    if (session.revoked) {
      writeLog('warn', 'socket.auth.session_revoked', {
        socketId: socket.id,
        jti,
        sid: session.sid
      });
      return next(new Error('Authentication failed: session revoked'));
    }

    if (session.sid !== sid) {
      writeLog('warn', 'socket.auth.sid_mismatch', {
        socketId: socket.id,
        expectedSid: session.sid,
        providedSid: sid
      });
      return next(new Error('Authentication failed: session ID mismatch'));
    }

    const clientContext = getSocketClientContext(socket);
    const currentFingerprint = buildClientFingerprint(clientContext);
    if (session.fingerprint !== currentFingerprint || session.fingerprint !== fp) {
      writeLog('warn', 'socket.auth.fingerprint_mismatch', {
        socketId: socket.id,
        sessionFp: session.fingerprint,
        tokenFp: fp,
        currentFp: currentFingerprint
      });
      return next(new Error('Authentication failed: fingerprint mismatch'));
    }

    if (session.activeSocketId) {
      const existingSocket = io.sockets.sockets.get(session.activeSocketId);
      if (existingSocket) {
        writeLog('warn', 'socket.auth.replay_detected', {
          socketId: socket.id,
          existingSocketId: session.activeSocketId,
          jti
        });
        return next(new Error('Authentication failed: session already active'));
      } else {
        writeLog('info', 'socket.auth.cleaning_stale_socket', {
          socketId: socket.id,
          staleSocketId: session.activeSocketId,
          jti
        });
        session.activeSocketId = null;
        await setTokenRecord(jti, session);
      }
    }

    session.activeSocketId = socket.id;
    await setTokenRecord(jti, session);

    socket.session = session;
    socket.claims = claims;
    socket.jti = jti;
    socket.sid = sid;

    tokenInvalidator.registerActiveSocket(jti, socket.id);
    socket.on('disconnect', () => {
      tokenInvalidator.unregisterActiveSocket(jti);
    });

    writeLog('info', 'socket.auth.success', {
      socketId: socket.id,
      jti,
      sid,
      ip: clientContext.ip
    });

    next();
  } catch (error) {
    captureError('socket.auth.middleware', error, {
      socketId: socket.id
    });
    return next(new Error('Authentication failed: internal error'));
  }
});

// ============================================================
// DB LIFECYCLE MONITOR - AGGIUNTO PER PROMPT 10
// ============================================================
let dbWasReady = false;
let dbOutageDisconnectApplied = false;

const monitorDbAndSocketLifecycle = async () => {
  try {
    const dbStatus = getDbStatus();
    const isDbReady = dbStatus.ready === true;

    if (!dbWasReady && isDbReady) {
      writeLog('info', 'db.lifecycle.available', {
        previousState: 'down',
        currentState: 'ready'
      });
      dbWasReady = true;
      dbOutageDisconnectApplied = false;
      io.emit('db-status', { status: 'ready' });
      return;
    }

    if (dbWasReady && !isDbReady) {
      writeLog('warn', 'db.lifecycle.unavailable', {
        previousState: 'ready',
        currentState: 'down'
      });
      dbWasReady = false;

      if (!dbOutageDisconnectApplied) {
        dbOutageDisconnectApplied = true;
        const activeSockets = await io.fetchSockets();
        const socketIds = activeSockets.map(s => s.id);

        writeLog('warn', 'db.lifecycle.disconnecting_sockets', {
          count: socketIds.length
        });

        io.emit('db-unavailable', {
          message: 'Database connection lost. Reconnecting...',
          timestamp: Date.now()
        });

        setTimeout(() => {
          for (const socket of activeSockets) {
            socket.disconnect(true);
          }
        }, 500);
      }
      return;
    }

    if (isDbReady && dbOutageDisconnectApplied) {
      dbOutageDisconnectApplied = false;
    }
  } catch (error) {
    captureError('db.lifecycle.monitor', error, {});
  }
};

const DB_MONITOR_INTERVAL_MS = 10000;
setInterval(monitorDbAndSocketLifecycle, DB_MONITOR_INTERVAL_MS);
setTimeout(monitorDbAndSocketLifecycle, 1000);

// ============================================================
// PEERJS CONFIGURATION - MODIFICATA PER LOAD TEST (Punto 16)
// ============================================================
const peerConcurrentLimit = parsePositiveInt(process.env.PEER_CONCURRENT_LIMIT, 1000);
const peerRateLimitWindowMs = parsePositiveInt(process.env.PEER_RATE_LIMIT_WINDOW_MS, 60000);
const peerRateLimitMaxRequests = parsePositiveInt(process.env.PEER_RATE_LIMIT_MAX_REQ, 180);
const PEER_MAX_CONNECTIONS_PER_IP = 1000; // Aumentato per load test (da 20 a 1000)

const peerIpRateLimiter = createIpRateLimiter({
  windowMs: peerRateLimitWindowMs,
  maxRequests: peerRateLimitMaxRequests
});

const peerServer = ExpressPeerServer(server, {
  path: '/myapp',
  allow_discovery: false,
  proxied: isProd,
  corsOptions: corsOptions
});

app.use('/peerjs', peerIpRateLimiter, peerServer);

// ============================================================
// ROUTES
// ============================================================

app.get('/api/health', (req, res) => {
  const db = getDbStatus();
  const statusCode = db.ready ? 200 : 503;
  return res.status(statusCode).json({
    ok: db.ready,
    db
  });
});

app.get('/api/health/token-registry', (req, res) => {
  return res.json(getHealthStatus());
});

app.get('/api/metrics', async (req, res) => {
  const metrics = await stateService.getStateMetrics();
  return res.json({
    state: metrics,
    tokenRegistry: getMetrics(),
    socket: { active: io.sockets.sockets.size }
  });
});

app.get('/api/socket-token', checkBan, authRateLimiter, fingerprintRateLimiter, async (req, res) => {
  const clientContext = getRequestClientContext(req);
  const payload = await sessionService.createSession(req, clientContext, socketTokenTtlSeconds);
  return res.json(payload);
});

app.post('/api/socket-token/revoke', checkBan, authRateLimiter, fingerprintRateLimiter, async (req, res) => {
  try {
    const { token } = req.body;
    const clientContext = getRequestClientContext(req);
    
    if (!token) {
      writeLog('warn', 'revoke.missing_token', { ip: clientContext.ip });
      return res.status(400).json({ error: 'Token richiesto nel body' });
    }
    
    // Validazione reason (opzionale)
    const allowedReasons = ['manual', 'timeout', 'security', 'admin'];
    const reason = allowedReasons.includes(req.body.reason) ? req.body.reason : 'manual';
    
    const revokeResult = await sessionService.revokeSession(token, {
      ip: clientContext.ip,
      userAgent: clientContext.userAgent,
      reason
    });
    
    // Mapping errorCode → HTTP status
    const statusMap = {
      'JWT_INVALID': 400,
      'JWT_EXPIRED': 400,
      'TOKEN_NOT_FOUND': 404,
      'REDIS_UNAVAILABLE': 503,
      'CONCURRENT_MODIFICATION': 409,
      'REVOCATION_FAILED': 500,
      'UNEXPECTED_ERROR': 500,
      'JWT_VERIFICATION_ERROR': 400
    };
    
    if (!revokeResult.revoked) {
      const statusCode = statusMap[revokeResult.errorCode] || 500;
      writeLog('warn', 'revoke.failed', {
        errorCode: revokeResult.errorCode,
        jti: revokeResult.jti,
        ip: clientContext.ip,
        latencyMs: revokeResult.latencyMs
      });
      return res.status(statusCode).json({
        error: revokeResult.errorCode,
        message: revokeResult.errorDetails || 'Revoca fallita',
        jti: revokeResult.jti,
        timestamp: revokeResult.timestamp
      });
    }
    
    writeLog('info', 'revoke.success', {
      jti: revokeResult.jti,
      source: revokeResult.source,
      ip: clientContext.ip,
      latencyMs: revokeResult.latencyMs
    });
    
    return res.json({ 
      message: 'Token revoked successfully',
      jti: revokeResult.jti,
      timestamp: revokeResult.timestamp,
      source: revokeResult.source
    });
    
  } catch (error) {
    captureError('revoke.endpoint.unexpected', error, { 
      ip: req.ip,
      bodyKeys: Object.keys(req.body || {})
    });
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

app.get('/api/turn-config', (req, res) => {
  const iceServers = getTurnIceServers();
  const credential = getTurnCredential();
  const webRtcConfig = getWebRtcConfig();

  if (iceServers.length === 0) {
    return res.json({
      iceServers: [],
      webRtcConfig,
      message: 'TURN not configured'
    });
  }

  const turnServers = iceServers.map((server) => {
    if (credential) {
      return {
        ...server,
        username: credential.username,
        credential: credential.credential
      };
    }
    return server;
  });

  res.json({
    iceServers: turnServers,
    webRtcConfig,
    ttl: credential?.ttl || null
  });
});

module.exports = {
  getTokenRecord,
  setTokenRecord,
  cleanupSocketTokenRegistry,
  socketTokenRegistry,
  pubClient,
  isRedisReady
};

// ============================================================
// STARTUP CLEANUP
// ============================================================

const runStartupStateCleanup = async () => {
  try {
    writeLog('info', 'startup.cleanup.starting');

    if (typeof stateService.cleanupBusyUsersOnStartup === 'function') {
      const result = await stateService.cleanupBusyUsersOnStartup();
      writeLog('info', 'startup.cleanup.busy_users_cleaned', {
        matched: result.matchedCount,
        modified: result.modifiedCount
      });
    } else {
      writeLog('warn', 'startup.cleanup.no_cleanup_function', {
        available: Object.keys(stateService)
      });
    }

    writeLog('info', 'startup.cleanup.completed');
  } catch (error) {
    captureError('startup.cleanup', error, {});
  }
};

const startServer = async () => {
  try {
    writeLog('info', 'bootstrap.db.connecting');
    await connectDB();
    writeLog('info', 'bootstrap.db.connected');

    await runStartupStateCleanup();

    server.listen(port, () => {
      writeLog('info', 'bootstrap.server.started', {
        port,
        env: nodeEnv,
        pid: process.pid
      });
    });
  } catch (error) {
    captureError('bootstrap.startup', error, {});
    writeLog('error', 'bootstrap.failed', { error: error.message });
    process.exit(1);
  }
};

startServer();