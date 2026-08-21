// server/services/sessionService.js
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { getTokenRecord, setTokenRecord } = require('../tokenRegistry');
const { jwtSecret } = require('../config');

/**
 * Crea una nuova sessione socket e genera un token JWT
 * @param {Object} req - Richiesta Express (non usata direttamente, ma mantenuta per compatibilità)
 * @param {Object} clientContext - { ip, userAgent }
 * @param {number} ttlSeconds - Tempo di validità del token in secondi
 * @returns {Promise<{ token: string }>}
 */
const createSession = async (req, clientContext, ttlSeconds) => {
  const jti = crypto.randomUUID();
  const sid = crypto.randomUUID();
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${clientContext.ip}|${clientContext.userAgent}`)
    .digest('hex');
  const expiresAtMs = Date.now() + ttlSeconds * 1000;

  await setTokenRecord(jti, {
    sid,
    fingerprint,
    revoked: false,
    activeSocketId: null,
    expiresAtMs,
  });

  const token = jwt.sign(
    {
      sid,
      jti,
      fp: fingerprint,
      type: 'socket-session',
    },
    jwtSecret,
    {
      algorithm: 'HS256',
      expiresIn: `${ttlSeconds}s`,
    }
  );

  return { token };
};

/**
 * Revoca un token socket esistente
 * @param {string} token - Token JWT da revocare
 * @returns {Promise<{ revoked: boolean }>}
 */
const revokeSession = async (token) => {
  try {
    const claims = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    const jti = claims?.jti;
    if (!jti) return { revoked: false };

    const session = await getTokenRecord(jti);
    if (!session) return { revoked: false };

    session.revoked = true;
    await setTokenRecord(jti, session);
    return { revoked: true };
  } catch (error) {
    return { revoked: false };
  }
};

module.exports = {
  createSession,
  revokeSession,
};