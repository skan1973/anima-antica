// server/redis.js
const { createClient } = require('ioredis');

// --- Prometheus Metrics (Best Practice: istanziare una sola volta) ---
// Si assume che 'prom-client' sia presente nelle dipendenze di progetto.
// Se non lo è, il codice degrada gracefulmente a no-op.
let register, migrationCounter, migrationDuration, queueGauge, opsCounter;
try {
  const promClient = require('prom-client');
  register = promClient.register;
  
  migrationCounter = new promClient.Counter({
    name: 'token_registry_migration_total',
    help: 'Total number of token registry migration attempts',
    labelNames: ['status'], // 'success', 'failure'
    registers: [register]
  });

  migrationDuration = new promClient.Histogram({
    name: 'token_registry_migration_duration_seconds',
    help: 'Duration of token registry migration in seconds',
    buckets: [0.1, 0.5, 1, 2, 5, 10],
    registers: [register]
  });

  queueGauge = new promClient.Gauge({
    name: 'token_registry_write_queue_size',
    help: 'Current size of the local write queue (Redis unavailable)',
    registers: [register]
  });

  opsCounter = new promClient.Counter({
    name: 'token_registry_operations_total',
    help: 'Total token registry operations',
    labelNames: ['op', 'store', 'status'], // op: set, get, revoke | store: redis, queue | status: ok, error
    registers: [register]
  });
} catch (e) {
  // Fallback no-op se prom-client non installato
  const noop = () => {};
  register = { getMetricsAsJSON: () => [] };
  migrationCounter = { inc: noop };
  migrationDuration = { observe: noop };
  queueGauge = { set: noop, inc: noop, dec: noop };
  opsCounter = { inc: noop };
}

const redisUrl = process.env.REDIS_URL;
let pubClient, subClient;
let isRedisReady = () => false;

const myInstanceId = process.env.INSTANCE_ID || `node-${process.pid}`;
let invalidateCallback = null;

module.exports.myInstanceId = myInstanceId;
module.exports.registerInvalidateCallback = (callback) => { invalidateCallback = callback; };

// --- Stato Globale per Resilienza ---
const writeQueue = []; // Write-Ahead Log: { jti, record, ttl, expiresAtMs, timestamp }
let migrationInProgress = false;
let lastConnectionError = null;

// Configurazione
const MIGRATION_TIMEOUT_MS = 5000;
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_WRITE_QUEUE_SIZE, 10) || 10000;

// Lua Script per UPSERT ATOMICO CON CONFRONTO EXPIRES_AT_MS
// Chiave: token:{jti}
// Valore JSON: { ..., expiresAtMs: number, revoked: bool }
// Logica: Se chiave non esiste -> SET. Se esiste -> Confronta expiresAtMs. Se nuovo > vecchio -> SET. Altrimenti ignora.
// Ritorna: 1 se scritto, 0 se scartato (vecchio più fresco), -1 se errore.
const UPSERT_IF_FRESHER_SCRIPT = `
local key = KEYS[1]
local new_val = ARGV[1]
local ttl = tonumber(ARGV[2])
local new_expires = cjson.decode(new_val).expiresAtMs

local current_val = redis.call('GET', key)
if current_val == false then
  redis.call('SET', key, new_val, 'EX', ttl)
  return 1
else
  local current_expires = cjson.decode(current_val).expiresAtMs
  if new_expires > current_expires then
    redis.call('SET', key, new_val, 'EX', ttl)
    return 1
  else
    return 0
  end
end
`;

let upsertScriptSha = null;

if (redisUrl) {
  pubClient = createClient({ 
    url: redisUrl,
    lazyConnect: true,
    maxRetriesPerRequest: 3, // Retry base per comandi singoli
    retryStrategy: (times) => {
      if (times > 3) return null; // Stop retry, trigger error event
      return Math.min(times * 200, 2000); // Backoff 200, 400, 600ms
    }
  });
  
    subClient = pubClient.duplicate();
  
  isRedisReady = () => pubClient && pubClient.status === 'ready';

  subClient.on('message', (channel, message) => {
    if (channel !== 'anima:token:invalidate') return;
    try {
      const payload = JSON.parse(message);
      if (payload.sourceInstanceId === myInstanceId) return; // Deduplicazione
      if (invalidateCallback) invalidateCallback(payload);
    } catch (err) {
      console.error('[REDIS] Pub/Sub parse error:', err.message);
    }
  });

  // Carica script Lua all'avvio
  pubClient.on('ready', async () => {
    try {
      upsertScriptSha = await pubClient.script('LOAD', UPSERT_IF_FRESHER_SCRIPT);
      console.log('[REDIS] Upsert Lua script loaded.');
    } catch (e) {
      console.error('[REDIS] Failed to load Lua script:', e.message);
    }
    
    // --- TRIGGER MIGRAZIONE (Prompt 2) ---
    if (migrationInProgress) return; // Guardia race condition

    const startTime = Date.now();
    migrationCounter.inc({ status: 'started' }); // Custom label per tracciare start se serve, ma usiamo success/failure
    console.log(`[LOG] token.registry.migration.started: queueSize=${writeQueue.length}`);

    if (writeQueue.length === 0) {
      migrationDuration.observe((Date.now() - startTime) / 1000);
      return;
    }

    migrationInProgress = true;
    const queueSnapshot = [...writeQueue];
    writeQueue.length = 0; // Svuota coda globale atomicamente
    queueGauge.set(writeQueue.length);

    let successCount = 0;
    let skippedCount = 0;
    let failCount = 0;

    try {
      // Esegui migrazione in batch parallelo controllato
      // Usiamo lo script Lua per atomicità e confronto expiresAtMs
      const pipeline = pubClient.pipeline();
      
      queueSnapshot.forEach(item => {
        if (upsertScriptSha) {
          pipeline.evalsha(upsertScriptSha, 1, `token:${item.jti}`, JSON.stringify(item.record), item.ttl);
        } else {
          // Fallback se script non caricato: SET NX semplice (meno sicuro ma funziona)
          pipeline.set(`token:${item.jti}`, JSON.stringify(item.record), 'EX', item.ttl, 'NX');
        }
      });

      const results = await Promise.race([
        pipeline.exec(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Migration timeout')), MIGRATION_TIMEOUT_MS))
      ]);

      results.forEach(([err, res]) => {
        if (err) {
          failCount++;
        } else if (res === 1 || res === 'OK') {
          successCount++;
        } else {
          // res === 0 (Lua) o null (SET NX fallito) -> Chiave esisteva con expiresAtMs >= nuovo
          skippedCount++;
        }
      });

      const durationMs = Date.now() - startTime;
      migrationDuration.observe(durationMs / 1000);
      migrationCounter.inc({ status: 'success' });
      
      opsCounter.inc({ op: 'migrate_flush', store: 'redis', status: 'ok' }, successCount);
      if (skippedCount) opsCounter.inc({ op: 'migrate_flush', store: 'redis', status: 'skipped' }, skippedCount);
      if (failCount) opsCounter.inc({ op: 'migrate_flush', store: 'redis', status: 'error' }, failCount);

      console.log(`[LOG] token.registry.migration.completed: count=${queueSnapshot.length}, success=${successCount}, skipped=${skippedCount}, failed=${failCount}, durationMs=${durationMs}`);

    } catch (error) {
      const durationMs = Date.now() - startTime;
      migrationDuration.observe(durationMs / 1000);
      migrationCounter.inc({ status: 'failure' });
      
      // Rollback coda: reinserisce gli item per ritentare al prossimo ready
      writeQueue.unshift(...queueSnapshot);
      queueGauge.set(writeQueue.length);
      
      opsCounter.inc({ op: 'migrate_flush', store: 'redis', status: 'error' }, queueSnapshot.length);
      
      console.error(`[LOG] token.registry.migration.failed: error=${error.message}, count=${queueSnapshot.length}, durationMs=${durationMs}`);
      
      if (durationMs >= MIGRATION_TIMEOUT_MS) {
        console.error(`[ALERT] Migration exceeded timeout ${MIGRATION_TIMEOUT_MS}ms. Queue size: ${writeQueue.length}. Manual intervention suggested.`);
      }

    } finally {
      migrationInProgress = false;
    }
  });

  // --- LISTENER CONNESSIONE PERSI (Degraded Mode) ---
  const handleConnectionLost = (err) => {
    lastConnectionError = err;
    console.warn(`[REDIS] Connection lost/error: ${err.message}. Switching to degraded write-mode (local queue).`);
    opsCounter.inc({ op: 'connection', store: 'redis', status: 'error' });
  };

  pubClient.on('end', handleConnectionLost);
  pubClient.on('error', handleConnectionLost);
  
  pubClient.on('reconnecting', (delay) => {
    console.log(`[REDIS] Reconnecting in ${delay}ms...`);
  });

  // Connessione iniziale
  pubClient.connect().catch(err => {
    console.error('[REDIS] Initial connection failed:', err.message);
    // L'app continua in modalità solo-memoria (degraded)
  });

} else {
  console.warn('[REDIS] REDIS_URL not set. Running in pure memory mode (no persistence).');
  isRedisReady = () => false;
}

/**
 * Scrittura Resiliente su Redis con Write-Ahead Log (WAL) se down.
 * Usa Lua Script per atomicità "Upsert if Fresher".
 */
const resilientSet = async (jti, record, ttl) => {
  const expiresAtMs = record.expiresAtMs || (Date.now() + (ttl * 1000));
  const payload = { ...record, expiresAtMs };
  const jsonPayload = JSON.stringify(payload);

  if (isRedisReady() && upsertScriptSha) {
    try {
      // Esegui script atomico
      const result = await pubClient.evalsha(upsertScriptSha, 1, `token:${jti}`, jsonPayload, ttl);
      if (result === 1) {
        opsCounter.inc({ op: 'set', store: 'redis', status: 'ok' });
        return { source: 'redis', written: true };
      } else {
        // Skipped: record su Redis più fresco
        opsCounter.inc({ op: 'set', store: 'redis', status: 'skipped' });
        return { source: 'redis', written: false, reason: 'fresher_exists' };
      }
    } catch (err) {
      // Se script fallisce (es. NOSCRIPT dopo flush), forza ricarica e riprova? 
      // Per semplicità: logghiamo e cadiamo in coda.
      console.error('[REDIS] Evalsha failed, falling back to queue:', err.message);
      // Non rilanciamo errore, andiamo in coda sotto
    }
  }

  // --- MODALITÀ DEGRADATA: Coda Locale (Write-Ahead Log) ---
  if (writeQueue.length >= MAX_QUEUE_SIZE) {
    opsCounter.inc({ op: 'set', store: 'queue', status: 'dropped' });
    queueGauge.set(writeQueue.length);
    throw new Error('Redis unavailable: Write queue full (max ' + MAX_QUEUE_SIZE + '). System degraded.');
  }

  writeQueue.push({ jti, record: payload, ttl, expiresAtMs, timestamp: Date.now() });
  queueGauge.set(writeQueue.length);
  opsCounter.inc({ op: 'set', store: 'queue', status: 'ok' });
  
  return { source: 'queue', written: true };
};

/**
 * Lettura resiliente: prova Redis, poi cache locale (se implementata esternamente).
 * Qui restituiamo solo la lettura Redis raw se pronto.
 */
const resilientGet = async (jti) => {
  if (!isRedisReady()) {
    opsCounter.inc({ op: 'get', store: 'redis', status: 'error' });
    return null; // Il chiamante (tokenRegistry) gestirà il fallback memoria
  }
  try {
    const data = await pubClient.get(`token:${jti}`);
    opsCounter.inc({ op: 'get', store: 'redis', status: 'ok' });
    return data ? JSON.parse(data) : null;
  } catch (err) {
    opsCounter.inc({ op: 'get', store: 'redis', status: 'error' });
    throw err;
  }
};

/**
 * Scansione non bloccante (SCAN)
 */
const scanKeys = async (pattern) => {
  if (!isRedisReady()) throw new Error('Cannot scan: Redis not ready');
  const keys = [];
  let cursor = '0';
  do {
    const reply = await pubClient.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = reply[0];
    keys.push(...reply[1]);
  } while (cursor !== '0');
  return keys;
};

const closeRedis = async () => {
  const clients = [pubClient, subClient].filter(Boolean);
  await Promise.all(clients.map(async (client) => {
    if (client.status === 'ready' || client.status === 'connecting') {
      await client.quit().catch(() => client.disconnect());
    }
  }));
};

module.exports = {
  pubClient,
  subClient,
  isRedisReady,
  scanKeys,
  closeRedis,
  redisUrl,
  // Nuove API Resilienti
  resilientSet,
  resilientGet,
  // Callback per invalidazione cross-instance
  registerInvalidateCallback: (callback) => { invalidateCallback = callback; },
  // Metriche
  metrics: {
    register,
    migrationCounter,
    migrationDuration,
    queueGauge,
    opsCounter
  },
  // Utility per health check / debug
  getWriteQueueSize: () => writeQueue.length,
  getWriteQueueSnapshot: () => [...writeQueue],
  isMigrationInProgress: () => migrationInProgress
};
