// server/services/sessionService.js
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getTokenRecord, setTokenRecord, deleteTokenRecord } = require('../tokenRegistry');
const { jwtSecret } = require('../config');
const { pubClient, isRedisReady } = require('../redis');
const { writeLog, captureError } = require('../logger');

// Costanti per retry con backoff esponenziale
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 50; // Starting backoff in milliseconds

/**
 * Crea una sessione token JWT.
 */
const createSession = async (req, clientContext, ttlSeconds) => {
  const sid = crypto.randomUUID();
  const jti = crypto.randomUUID();
  
  // Costruisci fingerprint robusto (IP + User-Agent + Accept-Language)
  const ip = clientContext?.ip || req.ip;
  const ua = req.headers['user-agent'] || '';
  const lang = req.headers['accept-language'] || '';
  const fingerprint = crypto.createHash('sha256').update(`${ip}|${ua}|${lang}`).digest('hex');

  // Calcola expiresAtMs per la cache locale
  const expiresAtMs = Date.now() + ttlSeconds * 1000;

  // Salva record token su Redis (via setTokenRecord)
  await setTokenRecord(jti, {
    sid,
    fingerprint,
    revoked: false,
    activeSocketId: null,
    expiresAtMs,
    type: 'socket-session',
  }, ttlSeconds);

  // Genera JWT
  const token = jwt.sign(
    { sid, jti, fp: fingerprint, exp: Math.floor(expiresAtMs / 1000) },
    jwtSecret,
    {
      algorithm: 'HS256'
    }
  );

  return { token, sid, jti, fingerprint };
};

/**
 * Revoca sessione con propagazione garantita + observability.
 * 
 * @param {string} token - JWT token da revocare
 * @param {Object} meta - Metadata aggiuntivi (ip, userAgent, reason, etc.)
 * @returns {Promise<{revoked: boolean, source: 'redis'|'memory'|'both', jti: string|null, timestamp: string}>}
 */
const revokeSession = async (token, meta = {}) => {
  const startTime = Date.now();
  let claims = null;
  let jti = null;

  try {
    // 1. Verifica JWT e estrai claims
    try {
      claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
      jti = claims?.jti;
      
      if (!jti) {
        writeLog('warn', 'jwt.missing_jti_in_claims', { 
          error: 'JTI not found in token claims' 
        });
        return { 
          revoked: false, 
          source: null, 
          jti: null, 
          timestamp: new Date().toISOString(),
          errorCode: 'JWT_INVALID',
          latencyMs: Date.now() - startTime 
        };
      }
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        writeLog('warn', 'jwt.expired', { 
          jti: jti || claims?.jti, 
          errorCode: jwtError.message 
        });
        return { 
          revoked: false, 
          source: null, 
          jti: jti || null, 
          timestamp: new Date().toISOString(),
          errorCode: 'JWT_EXPIRED',
          latencyMs: Date.now() - startTime 
        };
      } else if (jwtError.name === 'JsonWebTokenError') {
        writeLog('warn', 'jwt.invalid', { 
          errorCode: jwtError.message,
          jti: jti || claims?.jti 
        });
        return { 
          revoked: false, 
          source: null, 
          jti: jti || null, 
          timestamp: new Date().toISOString(),
          errorCode: 'JWT_INVALID',
          latencyMs: Date.now() - startTime 
        };
      }
      // Errore imprevisto del JWT
      captureError('jwt.verification.failed', jwtError, { token });
      return { 
        revoked: false, 
        source: null, 
        jti: jti || null, 
        timestamp: new Date().toISOString(),
        errorCode: 'JWT_VERIFICATION_ERROR',
        latencyMs: Date.now() - startTime 
      };
    }

    // 2. Recupera sessione esistente
    let session = await getTokenRecord(jti);
    
    if (!session) {
      writeLog('info', 'token.not_found_for_revocation', { jti });
      return { 
        revoked: false, 
        source: null, 
        jti, 
        timestamp: new Date().toISOString(),
        errorCode: 'TOKEN_NOT_FOUND',
        latencyMs: Date.now() - startTime 
      };
    }

    // 3. Tentativi di revoca con retry per conflitti concurrenti
    let lastError = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Segna come revoked
        session.revoked = true;
        session.revokedAt = Date.now();
        session.revokedReason = meta.reason || 'manual';

        // Scrittura su Redis (tramite primitiva di basso livello)
        const writeResult = await setTokenRecord(jti, session);

        if (!writeResult || (!writeResult.written && writeResult.source !== 'queue')) {
          throw new Error('Scrittura fallita: impossibile scrivere su Redis o coda');
        }

        // Determina source per return value
        const primarySource = writeResult.source === 'redis' ? 'redis' : 'memory';

        // 4. Propagazione Pub/Sub per invalidazione cross-instance
        let pubsubPropagated = false;
        
        if (isRedisReady() && pubClient) {
          try {
            await pubClient.publish('anima:token:invalidate', JSON.stringify({ 
              jti, 
              revokedAt: new Date().toISOString(), 
              sourceInstanceId: process.env.INSTANCE_ID || 'unknown',
              reason: meta.reason || 'manual'
            }));
            pubsubPropagated = true;
          } catch (pubError) {
            writeLog('warn', 'pubsub.publish.failed', { jti, error: pubError.message });
          }
        }

        // 5. Audit log strutturato
        writeLog('info', 'token.revoked', {
          jti,
          sid: session.sid,
          ip: meta.ip || 'unknown',
          userAgent: meta.userAgent || 'unknown',
          reason: meta.reason || 'manual',
          source: writeResult.source,
          pubsubPropagated,
        });

        // 6. Metrics
        try {
          const metrics = require('../redis').metrics;
          if (metrics?.opsCounter) {
            metrics.opsCounter.inc({ op: 'revoke', store: writeResult.source, status: 'ok' });
          }
        } catch (metricError) {}
        return { 
          revoked: true, 
          source: pubsubPropagated ? 'both' : primarySource,
          jti, 
          timestamp: new Date().toISOString(),
          latencyMs: Date.now() - startTime,
          retryAttempts: attempt
        };

      } catch (revokeError) {
        lastError = revokeError;
        
        // Controlla se è un errore di conflitto concurrente (WATCH failed o simile)
        if (revokeError.message?.includes('WATCH') || 
            revokeError.code === 'CONCURRENT_MODIFICATION' ||
            revokeError.name === 'RedisError' && revokeError.message?.includes('UNINDEXED')) {
          
          if (attempt < MAX_RETRIES) {
            // Backoff esponenziale: 50ms, 100ms, 200ms
            const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
            writeLog('warn', 'concurrent_modification_detected', { 
              jti, 
              attempt, 
              backoffMs 
            });
            
            // Aspetta il tempo di backoff
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue; // Ritenta
          } else {
            writeLog('error', 'max_retries_exceeded_concurrent_revocation', { 
              jti, 
              attempts: MAX_RETRIES 
            });
            break; // Esci dal loop di retry
          }
        }

        // Errore Redis non disponibile
        if (revokeError.message?.includes('Redis') || revokeError.code === 'ECONNREFUSED') {
          writeLog('error', 'redis_unavailable_during_revocation', { 
            jti, 
            error: revokeError.message 
          });
          
          // Metriche di fallimento
          try {
            const metrics = require('../redis').metrics;
            if (metrics?.opsCounter) {
              metrics.opsCounter.inc({ 
                op: 'revoke', 
                store: 'redis', 
                status: 'error' 
              });
            }
          } catch (metricError) {
            // Ignora errori metriche
          }

          return { 
            revoked: false, 
            source: null, 
            jti, 
            timestamp: new Date().toISOString(),
            errorCode: 'REDIS_UNAVAILABLE',
            latencyMs: Date.now() - startTime 
          };
        }

        // Altri errori imprevisti
        captureError('token.revocation.failed', revokeError, { jti, attempt });
      }
    }

    // Se arriviamo qui, tutti i tentativi sono falliti
    return { 
      revoked: false, 
      source: null, 
      jti, 
      timestamp: new Date().toISOString(),
      errorCode: 'REVOCATION_FAILED',
      errorDetails: lastError?.message || 'Unknown error during revocation',
      latencyMs: Date.now() - startTime,
      retryAttemptsUsed: MAX_RETRIES
    };

  } catch (error) {
    // Error handling finale per errori non gestiti
    captureError('token.revocation.unexpected_error', error, { 
      jti, 
      token_preview: token?.substring(0, 10) + '...' 
    });

    return { 
      revoked: false, 
      source: null, 
      jti, 
      timestamp: new Date().toISOString(),
      errorCode: 'UNEXPECTED_ERROR',
      errorDetails: error.message,
      latencyMs: Date.now() - startTime 
    };
  }
};

/**
 * Pulisce le sessioni scadute dal registry in-memory (se usato)
 */
const cleanupExpiredSessions = async () => {
  try {
    const now = Date.now();
    let cleanedCount = 0;

    // Se usiamo socketTokenRegistry, lo puliamo
    const { socketTokenRegistry } = require('../tokenRegistry');
    
    for (const [jti, record] of socketTokenRegistry.entries()) {
      if (record.revoked || record.expiresAtMs <= now) {
        socketTokenRegistry.delete(jti);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      writeLog('info', 'expired_sessions_cleaned', { 
        cleanedCount, 
        remaining: socketTokenRegistry.size 
      });
    }

    return cleanedCount;
  } catch (error) {
    captureError('cleanup.expired_sessions.failed', error);
    return 0;
  }
};

module.exports = {
  createSession,
  revokeSession,
  cleanupExpiredSessions,
};