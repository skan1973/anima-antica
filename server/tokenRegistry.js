// server/tokenRegistry.js
const { isRedisReady, resilientSet, resilientGet } = require('./redis');
const { recordOp, recordCleanup, updateRegistrySize, setTtlGauge } = require('./metrics');

// Token registry in-memory (Cache locale per letture veloci e fallback lettura durante outage)
// NOTA: La scrittura affidabile (durabilità) è delegata a resilientSet (Redis + Coda WAL)
const socketTokenRegistry = new Map();

// Costanti da env
const DEFAULT_TTL = parseInt(process.env.TOKEN_TTL_SECONDS, 10) || 3600;
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS, 10) || 60000;

setTtlGauge(DEFAULT_TTL);

/**
 * Pulisce i token scaduti dal registry in-memory
 */
const cleanupSocketTokenRegistry = () => {
  const now = Date.now();
  let removed = 0;
  for (const [jti, record] of socketTokenRegistry.entries()) {
    if (record.expiresAtMs <= now) {
      socketTokenRegistry.delete(jti);
      removed++;
    }
  }
    if (removed > 0) {
      recordCleanup(removed);
      updateRegistrySize('memory', socketTokenRegistry.size);
    }
  return removed;
  };

/**
 * Salva un record token.
 * Usa resilientSet da redis.js che gestisce: Redis diretto + Coda WAL se down + Atomicità Lua (expiresAtMs).
 * Aggiorna anche cache locale per letture immediate.
 */
const setTokenRecord = async (jti, record) => {
  const ttl = record.expiresAt ? Math.ceil((record.expiresAt - Date.now()) / 1000) : DEFAULT_TTL;

  // 1. Scrittura resiliente (Redis o Coda)
  let writeResult;
  try {
    writeResult = await resilientSet(jti, record, ttl);
    recordOp('set', writeResult.source, 'ok');
  } catch (err) {
    recordOp('set', 'redis', 'error');
    throw err;
  }

  // 2. Aggiorna cache locale (Best effort per read-after-write consistency locale)
  // Calcola expiresAtMs per la cache locale
  const expiresAtMs = record.expiresAtMs || (Date.now() + (ttl * 1000));
  socketTokenRegistry.set(jti, {
    ...record,
    expiresAtMs,
    updatedAt: Date.now(),
    _writeSource: writeResult.source // 'redis' | 'queue'
  });

  return writeResult;
};

/**
 * Primitive di basso livello per cancellazione/revoca tecnica.
 * NON contiene logica di business o audit log (delegati al Service).
 */
const deleteTokenRecord = async (jti) => {
  // Invalida Cache Locale
  socketTokenRegistry.delete(jti);
  // Scrittura atomica su Redis (delega a resilientSet per consistenza)
  // Usiamo un TTL minimo o cancellazione diretta se supportata
  try {
    const res = await resilientSet(jti, { revoked: true, revokedAt: Date.now() }, 60);
    recordOp('revoke', res.source, 'ok');
    return res;
  } catch (err) {
      recordOp('revoke', 'redis', 'error');
      throw err;
  }
};

/**
 * Recupera un record token.
 * Strategia: Cache Locale -> Redis (se ready) -> Null
 */
const getTokenRecord = async (jti) => {
  // 1. Cache Locale (Velocissimo, serve per socket attivi)
  const localRecord = socketTokenRegistry.get(jti);
  if (localRecord && localRecord.expiresAtMs > Date.now()) {
    recordOp('get', 'memory', 'ok');
    return localRecord;
  }
  // Se scaduto in locale, puliamo e andiamo avanti
  if (localRecord) {
      socketTokenRegistry.delete(jti);
  }

  // 2. Redis (Fonte di verità)
  if (isRedisReady()) {
    try {
      const data = await resilientGet(jti);
      if (data) {
        // Popola cache locale con dato fresco da Redis
        socketTokenRegistry.set(jti, {
          ...data,
          expiresAtMs: data.expiresAtMs || (Date.now() + DEFAULT_TTL * 1000)
        });
        updateRegistrySize('memory', socketTokenRegistry.size);
        recordOp('get', 'redis', 'ok');
        return data;
      }
      recordOp('get', 'redis', 'ok'); // Hit, ma null
    } catch (err) {
      recordOp('get', 'redis', 'error');
      // Errore loggato dentro resilientGet, torniamo null per non bloccare
      console.error('[TokenRegistry] Redis read error:', err.message);
    }
  }

  // 3. Fallback: Se Redis down e non in cache locale, non abbiamo dati freschi.
  // I dati nella coda WAL (redis.js) non sono leggibili direttamente qui per progettazione (write-only queue).
  return null;
};

// Cleanup job periodico con metrica
if (CLEANUP_INTERVAL_MS > 0) {
  setInterval(() => {
    const removed = cleanupSocketTokenRegistry();
    if (removed > 0) {
      console.log(`[LOG] token.registry.cleanup: removed=${removed}, remaining=${socketTokenRegistry.size}`);
      // Metrica inviata via redis.js opsCounter se accessibile, qui log only
    }
  }, CLEANUP_INTERVAL_MS);
}

// Health Check Helper
const getHealthStatus = () => {
  const redisMetrics = require('./redis').metrics;
  return {
    redis: isRedisReady(),
    memorySize: socketTokenRegistry.size,
    oldestTokenAgeMs: (() => {
      let oldest = Infinity;
      const now = Date.now();
      for (const r of socketTokenRegistry.values()) {
        if (r.updatedAt) oldest = Math.min(oldest, now - r.updatedAt);
      }
      return oldest === Infinity ? 0 : oldest;
    })(),
    writeQueueSize: require('./redis').getWriteQueueSize(),
    migrationInProgress: require('./redis').isMigrationInProgress()
  };
};

module.exports = {
  setTokenRecord,
  getTokenRecord,
  deleteTokenRecord, // Primitive esportata
  cleanupSocketTokenRegistry,
  socketTokenRegistry, // Esportato per debug/test diretti se necessario
  getHealthStatus,
  // Re-export metriche per endpoint /metrics centrale
  getRedisMetrics: () => require('./redis').metrics
};

