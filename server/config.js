// server/config.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const MIN_JWT_SECRET_LENGTH = 32;

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
    console.error('config.jwt.invalid', { reasons });
    process.exit(1);
  }

  return secret;
};

const jwtSecret = validateJwtSecretOrExit(process.env.JWT_SECRET);

module.exports = {
  jwtSecret
};