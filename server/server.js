// server/server.js
const express = require('express');
const http = require('http');
const crypto = require('node:crypto');
const { Server } = require('socket.io');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const { ExpressPeerServer } = require('peer');
const socketController = require('./controllers/socketController');
const stateService = require('./services/stateService');
const { validateRequest, schemas } = require('./middleware/validator');
const { writeLog, captureError } = require('./logger');

require('dotenv').config({ path: __dirname + '/.env' });
const { connectDB, isDbReady, getDbStatus } = require('./db');

const MIN_JWT_SECRET_LENGTH = 32;
const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const ALLOWED_NODE_ENVS = new Set(['development', 'test', 'production']);
const DEFAULT_SOCKET_TOKEN_TTL_SECONDS = 3600;

const validateJwtSecretOrExit = (secretValue) => {
  const secret = typeof secretValue === 'string' ? secretValue.trim() : '';
  const reasons = [];

  if (!secret) {
    reasons.push('JWT_SECRET non impostato');
  }

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    reasons.push(`JWT_SECRET troppo corto (minimo ${MIN_JWT_SECRET_LENGTH} caratteri)`);
  }

  if (/^<.*>$/.test(secret)) {
    reasons.push('JWT_SECRET sembra un placeholder');
  }

  const weakPatterns = [
    /^(secret|changeme|password|default)$/i,
    /^jwt([_-]?secret)?$/i,
    /^anima[_-]?antica[_-]?super[_-]?secret/i,
    /^(1234|qwerty|admin)/i
  ];

  if (weakPatterns.some((pattern) => pattern.test(secret))) {
    reasons.push('JWT_SECRET usa un valore facilmente indovinabile');
  }

  if (reasons.length > 0) {
    writeLog('error', 'config.jwt.invalid', {
      reasons,
      advice: 'Imposta una chiave robusta (esempio: 48+ byte random).'
    });
    process.exit(1);
  }

  return secret;
};

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

const SOCKET_DB_MONITOR_INTERVAL_MS = 1000;

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
const jwtSecret = validateJwtSecretOrExit(process.env.JWT_SECRET);
const allowedClientOrigins = validateClientOriginsOrExit(process.env.CLIENT_ORIGIN, isProd);
const port = validatePortOrExit(process.env.PORT, isProd);
const socketTokenTtlSeconds = parsePositiveInt(process.env.SOCKET_TOKEN_TTL_SECONDS, DEFAULT_SOCKET_TOKEN_TTL_SECONDS);

const socketTokenRegistry = new Map();

const cleanupSocketTokenRegistry = () => {
  const now = Date.now();
  for (const [jti, record] of socketTokenRegistry.entries()) {
    if (record.expiresAtMs <= now) {
      socketTokenRegistry.delete(jti);
    }
  }
};

setInterval(() => {
  cleanupSocketTokenRegistry();
}, 60000).unref();

const createSocketSessionToken = (req) => {
  cleanupSocketTokenRegistry();

  const sid = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const fingerprint = buildClientFingerprint(getRequestClientContext(req));
  const expiresAtMs = Date.now() + socketTokenTtlSeconds * 1000;

  socketTokenRegistry.set(jti, {
    sid,
    fingerprint,
    revoked: false,
    activeSocketId: null,
    expiresAtMs
  });

  const token = jwt.sign(
    {
      sid,
      jti,
      fp: fingerprint,
      type: 'socket-session'
    },
    jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: `${socketTokenTtlSeconds}s`
    }
  );

  return { token };
};

const revokeSocketToken = (token) => {
  try {
    const claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    const jti = typeof claims?.jti === 'string' ? claims.jti : null;
    if (!jti) return { revoked: false };
    const session = socketTokenRegistry.get(jti);
    if (!session) return { revoked: false };
    session.revoked = true;
    const activeSocketId = session.activeSocketId;
    session.activeSocketId = null;
    return { revoked: true, activeSocketId };
  } catch (error) {
    return { revoked: false };
  }
};

let startupStateCleanupCompleted = false;

const runStartupStateCleanup = async () => {
  if (startupStateCleanupCompleted || !isDbReady()) {
    return false;
  }

  try {
    const result = await stateService.cleanupBusyUsersOnStartup();
    startupStateCleanupCompleted = true;
    writeLog('info', 'startup.state_cleanup.completed', result);
    return true;
  } catch (error) {
    captureError('startup.state_cleanup.failed', error);
    return false;
  }
};
const app = express();
app.disable('x-powered-by');

if (isProd) {
  app.set('trust proxy', 1);
}

const cspConnectSrc = [
  "'self'",
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'ws://localhost:3000',
  'ws://127.0.0.1:3000',
  'https://unpkg.com'
];

if (isProd) {
  cspConnectSrc.push('wss:');
  cspConnectSrc.push('https:');
}

const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", 'https://unpkg.com'],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:', 'blob:'],
  connectSrc: cspConnectSrc,
  mediaSrc: ["'self'", 'data:', 'blob:'],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"]
};

if (isProd) {
  cspDirectives.upgradeInsecureRequests = [];
}

app.use(helmet({
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
  crossOriginEmbedderPolicy: false,
  hsts: isProd
    ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    : false,
  permissionsPolicy: {
    features: {
      camera: ["'self'"],
      microphone: ["'self'"],
      geolocation: []
    }
  },
  contentSecurityPolicy: {
    directives: cspDirectives
  }
}));

app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  const requestId = typeof req.headers['x-request-id'] === 'string'
    ? req.headers['x-request-id']
    : crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.get('/api/health', (req, res) => {
  const db = getDbStatus();
  const statusCode = db.ready ? 200 : 503;
  return res.status(statusCode).json({
    ok: db.ready,
    db
  });
});

const requireDbReady = (req, res, next) => {
  if (isDbReady()) return next();
  return res.status(503).json({ error: 'Servizio temporaneamente non disponibile.' });
};

app.get('/api/socket-token', (req, res) => {
  const payload = createSocketSessionToken(req);
  return res.json(payload);
});

app.post('/api/socket-token/revoke', validateRequest(schemas.socketTokenRevoke), (req, res) => {
  const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  const bodyToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const token = bearerToken || bodyToken;

  if (!token) {
    return res.status(400).json({ error: 'Token mancante.' });
  }

  const { revoked, activeSocketId } = revokeSocketToken(token);
  if (!revoked) {
    return res.status(400).json({ error: 'Token non valido o non revocabile.' });
  }

  if (activeSocketId) {
    const activeSocket = io?.sockets?.sockets?.get(activeSocketId);
    if (activeSocket) {
      activeSocket.emit('auth-revoked');
      activeSocket.disconnect(true);
    }
  }

  return res.status(200).json({ ok: true });
});

// Any future API endpoint under /api will be protected from zombie DB state.
app.use('/api', requireDbReady);

app.get('/api/db-ready', requireDbReady, (req, res) => {
  res.status(200).json({ ok: true });
});

app.use(express.static('public'));

// Never expose internal stack traces to clients.
app.use((err, req, res, next) => {
  const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  captureError('http.unhandled_error', err, {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    ip: req.ip,
    userAgent: req.headers['user-agent']
  });
  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Errore interno del server.' : 'Richiesta non valida.'
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow non-browser clients that do not send Origin (CLI tests, server-to-server).
      if (!origin) return callback(null, true);

      if (allowedClientOrigins.has(origin)) {
        return callback(null, true);
      }

      return callback(new Error('CORS_ORIGIN_DENIED'));
    },
    methods: ['GET', 'POST']
  }
});

const peerConcurrentLimit = parsePositiveInt(process.env.PEER_CONCURRENT_LIMIT, 1000);
const peerRateLimitWindowMs = parsePositiveInt(process.env.PEER_RATE_LIMIT_WINDOW_MS, 60000);
const peerRateLimitMaxRequests = parsePositiveInt(process.env.PEER_RATE_LIMIT_MAX_REQ, 180);
const peerMaxConnectionsPerIp = parsePositiveInt(process.env.PEER_MAX_CONNECTIONS_PER_IP, 20);
const peerIpRateLimiter = createIpRateLimiter({
  windowMs: peerRateLimitWindowMs,
  maxRequests: peerRateLimitMaxRequests
});

const peerServer = ExpressPeerServer(server, {
  path: '/myapp',
  allow_discovery: false,
  proxied: isProd,
  concurrent_limit: peerConcurrentLimit,
  corsOptions: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedClientOrigins.has(origin)) return callback(null, true);
      return callback(new Error('CORS_ORIGIN_DENIED'));
    }
  }
});

app.use('/peerjs', peerIpRateLimiter, peerServer);

const peerConnectionsByIp = new Map();
const peerClientIpById = new Map();

peerServer.on('connection', (client) => {
  const socket = client.getSocket();
  const remoteIp = socket?._socket?.remoteAddress || socket?._socket?.address()?.address || 'unknown';

  const current = peerConnectionsByIp.get(remoteIp) || 0;
  if (current >= peerMaxConnectionsPerIp) {
    console.warn(`Peer limit superato per IP ${remoteIp}. Connessione chiusa.`);
    try {
      socket?.close(1008, 'PEER_IP_LIMIT_REACHED');
    } catch (error) {
      console.warn('Errore chiusura socket peer in eccesso:', error.message);
    }
    return;
  }

  peerConnectionsByIp.set(remoteIp, current + 1);
  peerClientIpById.set(client.getId(), remoteIp);
  writeLog('info', 'peer.connected', {
    peerId: client.getId(),
    ip: remoteIp
  });
});

peerServer.on('disconnect', (client) => {
  const remoteIp = peerClientIpById.get(client.getId());
  if (remoteIp) {
    const current = peerConnectionsByIp.get(remoteIp) || 0;
    if (current <= 1) peerConnectionsByIp.delete(remoteIp);
    else peerConnectionsByIp.set(remoteIp, current - 1);
    peerClientIpById.delete(client.getId());
  }

  writeLog('info', 'peer.disconnected', {
    peerId: client.getId(),
    ip: remoteIp || 'unknown'
  });
});

io.use((socket, next) => {
  if (!isDbReady()) {
    return next(new Error('SERVICE_UNAVAILABLE'));
  }

  if (!jwtSecret) {
    return next(new Error('AUTH_CONFIG_MISSING'));
  }

  const authToken = socket.handshake.auth?.token;
  if (typeof authToken !== 'string' || !authToken.trim()) {
    return next(new Error('AUTH_REQUIRED'));
  }

  try {
    const claims = jwt.verify(authToken, jwtSecret, { algorithms: ['HS256'] });
    if (!claims || claims.type !== 'socket-session') {
      return next(new Error('AUTH_INVALID'));
    }

    const sid = typeof claims.sid === 'string' ? claims.sid : '';
    const jti = typeof claims.jti === 'string' ? claims.jti : '';
    const tokenFingerprint = typeof claims.fp === 'string' ? claims.fp : '';
    if (!sid || !jti || !tokenFingerprint) {
      return next(new Error('AUTH_INVALID'));
    }

    cleanupSocketTokenRegistry();
    const session = socketTokenRegistry.get(jti);
    if (!session || session.sid !== sid) {
      return next(new Error('AUTH_REVOKED'));
    }
    if (session.revoked) {
      return next(new Error('AUTH_REVOKED'));
    }

    const now = Date.now();
    if (session.expiresAtMs <= now) {
      socketTokenRegistry.delete(jti);
      return next(new Error('AUTH_EXPIRED'));
    }

    const handshakeFingerprint = buildClientFingerprint(getSocketClientContext(socket));
    if (session.fingerprint !== tokenFingerprint || tokenFingerprint !== handshakeFingerprint) {
      return next(new Error('AUTH_CONTEXT_MISMATCH'));
    }

    if (session.activeSocketId && session.activeSocketId !== socket.id) {
      return next(new Error('AUTH_REPLAY_DETECTED'));
    }

    session.activeSocketId = socket.id;

    socket.data.auth = {
      sid,
      jti
    };
    return next();
  } catch (error) {
    return next(new Error('AUTH_INVALID'));
  }
});

socketController(io, {
  onSocketDisconnect: (socket) => {
    const jti = socket?.data?.auth?.jti;
    if (!jti) return;
    const session = socketTokenRegistry.get(jti);
    if (!session) return;
    if (session.activeSocketId === socket.id) {
      session.activeSocketId = null;
    }
  }
});

let dbWasReady = isDbReady();
let dbOutageDisconnectApplied = false;

const monitorDbAndSocketLifecycle = () => {
  const dbReadyNow = isDbReady();

  if (!dbReadyNow && dbWasReady && !dbOutageDisconnectApplied) {
    dbOutageDisconnectApplied = true;
    writeLog('warn', 'db.outage.disconnect_sockets', {
      activeSockets: io.sockets.sockets.size
    });

    for (const socket of io.sockets.sockets.values()) {
      socket.emit('db-unavailable');
      socket.disconnect(true);
    }
  }

  if (dbReadyNow && (!dbWasReady || dbOutageDisconnectApplied)) {
    dbOutageDisconnectApplied = false;
    writeLog('info', 'db.available.accept_reconnect');
  }

  if (dbReadyNow && !startupStateCleanupCompleted) {
    void runStartupStateCleanup();
  }

  dbWasReady = dbReadyNow;
};

setInterval(monitorDbAndSocketLifecycle, SOCKET_DB_MONITOR_INTERVAL_MS).unref();

const bootstrapServer = async () => {
  await connectDB();
  await runStartupStateCleanup();

  server.listen(port, () => {
    writeLog('info', 'server.started', {
      port,
      nodeEnv,
      monitorWebhookConfigured: Boolean(process.env.ERROR_MONITOR_WEBHOOK_URL)
    });
  });
};

void bootstrapServer().catch((error) => {
  captureError('startup.db.bootstrap.failed', error);
});
