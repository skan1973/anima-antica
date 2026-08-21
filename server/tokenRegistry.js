// server/tokenRegistry.js
const { pubClient, isRedisReady } = require('./redis');

// Token registry in-memory (fallback quando Redis non è disponibile)
const socketTokenRegistry = new Map();

/**
 * Pulisce i token scaduti dal registry in-memory
 */
const cleanupSocketTokenRegistry = () => {
  const now = Date.now();
  for (const [jti, record] of socketTokenRegistry.entries()) {
    if (record.expiresAtMs <= now) {
      socketTokenRegistry.delete(jti);
    }
  }
};

/**
 * Salva un record token nel registry (Redis o in-memory)
 * @param {string} jti - Token ID
 * @param {Object} record - Record da salvare
 */
const setTokenRecord = async (jti, record) => {
  if (isRedisReady()) {
    await pubClient.set(`token:${jti}`, JSON.stringify(record), 'EX', 3600);
  } else {
    socketTokenRegistry.set(jti, { ...record, expiresAtMs: Date.now() + 3600 * 1000 });
  }
};

/**
 * Recupera un record token dal registry (Redis o in-memory)
 * @param {string} jti - Token ID
 * @returns {Promise<Object|null>} - Record token o null
 */
const getTokenRecord = async (jti) => {
  if (isRedisReady()) {
    const data = await pubClient.get(`token:${jti}`);
    return data ? JSON.parse(data) : null;
  }
  cleanupSocketTokenRegistry();
  return socketTokenRegistry.get(jti) || null;
};

module.exports = {
  setTokenRecord,
  getTokenRecord,
  cleanupSocketTokenRegistry,
  socketTokenRegistry
};