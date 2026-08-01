// server/db.js
const mongoose = require('mongoose');
const { NICK_REGEX } = require('./schemas/userLoginSchema');
const { writeLog, captureError } = require('./logger');
let passwordHasher;
let dbReady = false;
let reconnectTimer = null;
let reconnectAttempt = 0;
let listenersAttached = false;

const RETRY_BASE_MS = Number.parseInt(process.env.DB_RETRY_BASE_MS || '2000', 10);
const RETRY_MAX_MS = Number.parseInt(process.env.DB_RETRY_MAX_MS || '30000', 10);

// Defensive setting against query selector injection in filters.
mongoose.set('sanitizeFilter', true);

try {
  // Native bcrypt uses libuv threadpool and is generally safer under load.
  passwordHasher = require('bcrypt');
} catch (error) {
  passwordHasher = require('bcryptjs');
}

const userSchema = new mongoose.Schema({
  nick: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 24,
    match: NICK_REGEX
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    maxlength: 128,
    select: false
  },
  lastSeen: {
    type: Date,
    default: null
  },
  status: { type: String, enum: ['libero', 'occupato'], default: 'libero' },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((hookName) => {
  userSchema.pre(hookName, function(next) {
    this.setOptions({ runValidators: true, context: 'query' });
    next();
  });
});

userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;
  const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  const hash = await passwordHasher.hash(this.password, Number.isFinite(rounds) ? rounds : 10);
  this.password = hash;
});

const User = mongoose.model('User', userSchema);

const readyStateToLabel = (state) => {
  switch (state) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'unknown';
  }
};

const clearReconnectTimer = () => {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
};

const getRetryDelayMs = () => {
  const safeBase = Number.isFinite(RETRY_BASE_MS) && RETRY_BASE_MS > 0 ? RETRY_BASE_MS : 2000;
  const safeMax = Number.isFinite(RETRY_MAX_MS) && RETRY_MAX_MS >= safeBase ? RETRY_MAX_MS : 30000;
  const factor = Math.min(reconnectAttempt, 6);
  return Math.min(safeBase * (2 ** factor), safeMax);
};

const isDbReady = () => dbReady;

const getDbStatus = () => ({
  ready: dbReady,
  readyState: mongoose.connection.readyState,
  stateLabel: readyStateToLabel(mongoose.connection.readyState)
});

const scheduleReconnect = (reason) => {
  if (reconnectTimer) return;

  const delayMs = getRetryDelayMs();
  reconnectAttempt += 1;
  writeLog('warn', 'db.reconnect.scheduled', { delayMs, reason });

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await connectDB();
  }, delayMs);
};

const attachConnectionListeners = () => {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on('connected', () => {
    dbReady = true;
    reconnectAttempt = 0;
    clearReconnectTimer();
    writeLog('info', 'db.connected');
  });

  mongoose.connection.on('disconnected', () => {
    dbReady = false;
    writeLog('warn', 'db.disconnected');
    scheduleReconnect('disconnect-event');
  });

  mongoose.connection.on('error', (err) => {
    dbReady = mongoose.connection.readyState === 1;
    captureError('db.connection.error', err, {
      readyState: mongoose.connection.readyState
    });
  });
};

const connectDB = async () => {
  attachConnectionListeners();

  const uri = process.env.MONGO_URI;
  if (!uri) {
    writeLog('warn', 'db.connection.skipped', {
      reason: 'MONGO_URI non impostato'
    });
    dbReady = false;
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    dbReady = true;
    return true;
  }

  if (mongoose.connection.readyState === 2) {
    return false;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000
    });
    dbReady = true;
    reconnectAttempt = 0;
    clearReconnectTimer();
    writeLog('info', 'db.connection.ready');
    return true;
  } catch (err) {
    dbReady = false;
    captureError('db.connection.failed', err, {
      mode: 'degraded'
    });
    writeLog('warn', 'db.connection.degraded_mode');
    scheduleReconnect('initial-connect-failed');
    return false;
  }
};

module.exports = {
  User,
  connectDB,
  isDbReady,
  getDbStatus
};