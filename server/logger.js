const crypto = require('node:crypto');

const LOG_INCLUDE_STACK = process.env.LOG_INCLUDE_STACK === 'true';
const ERROR_MONITOR_WEBHOOK_URL = typeof process.env.ERROR_MONITOR_WEBHOOK_URL === 'string'
  ? process.env.ERROR_MONITOR_WEBHOOK_URL.trim()
  : '';
const ERROR_MONITOR_TIMEOUT_MS = Number.parseInt(process.env.ERROR_MONITOR_TIMEOUT_MS || '3000', 10);

// ============================================================
// PRIVACY & PII REDACTION PATTERNS (Punto 14)
// ============================================================

// Pattern per chiavi sensibili (già presente)
const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|set-cookie|api[_-]?key|mongo(uri)?|jwt|stripe|access[_-]?token|refresh[_-]?token|private|key|credential)/i;

// Pattern per PII - aggiunto per compliance GDPR/Privacy
const PII_KEY_PATTERN = /(email|mail|phone|telefono|cellulare|address|indirizzo|city|citta|country|nazione|cap|zip|nick|nickname|username|user|name|nome|cognome|surname|lastname|firstname|ip|clientIp|userAgent)/i;

// Pattern per contenuti media (snapshot) - non devono mai essere loggati
const MEDIA_PATTERN = /(snapshot|imageDataUrl|avatar|photo|picture|profilePic|image|video|audio|stream|blob|data:image|data:video|data:audio)/i;

// Pattern per token e credenziali (già presenti)
const MONGO_CREDENTIAL_PATTERN = /(mongodb(?:\+srv)?:\/\/[^:]+):([^@]+)@/i;
const BEARER_PATTERN = /(bearer\s+)[a-z0-9._~+\/-]+/gi;
const LONG_SECRET_PATTERN = /([A-Za-z0-9_\-]{24,})/g;

/**
 * Sanitizza una stringa rimuovendo pattern sensibili
 */
function sanitizeString(value) {
  if (typeof value !== 'string') return value;

  let output = value;
  output = output.replace(MONGO_CREDENTIAL_PATTERN, '$1<redacted-user>:<redacted-pass>@');
  output = output.replace(BEARER_PATTERN, '$1<redacted-token>');

  // Redige stringhe lunghe (potenziali token/segreti)
  output = output.replace(LONG_SECRET_PATTERN, (candidate) => {
    const looksLikeWord = /^[a-z]+$/i.test(candidate);
    if (looksLikeWord) return candidate;
    return '<redacted-value>';
  });

  // Redige pattern di PII comuni (email, telefono, IP)
  output = output.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '<redacted-email>');
  output = output.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '<redacted-phone>');
  output = output.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<redacted-ip>');

  return output;
}

/**
 * Redige in profondità un oggetto, rimuovendo PII e dati sensibili
 */
function redact(value, depth = 0) {
  if (depth > 5) return '[max-depth]';

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      // Controlla se è una chiave sensibile o PII
      if (SENSITIVE_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key)) {
        out[key] = '<redacted>';
        continue;
      }
      // Controlla se è un contenuto media (snapshot, immagini, ecc.)
      if (MEDIA_PATTERN.test(key)) {
        out[key] = '<redacted-media>';
        continue;
      }
      // Redige ricorsivamente
      out[key] = redact(nested, depth + 1);
    }
    return out;
  }

  if (typeof value === 'string') {
    // Controlla se la stringa stessa è un contenuto media
    if (value.startsWith('data:image/') || value.startsWith('data:video/') || value.startsWith('data:audio/')) {
      return '<redacted-media>';
    }
    return sanitizeString(value);
  }

  return value;
}

function serializeError(error, includeStack = LOG_INCLUDE_STACK) {
  if (!error) {
    return { name: 'Error', message: 'Unknown error' };
  }

  const name = sanitizeString(error.name || 'Error');
  const message = sanitizeString(error.message || String(error));
  const stack = includeStack && typeof error.stack === 'string'
    ? sanitizeString(error.stack).split('\n').slice(0, 12).join('\n')
    : undefined;
  const fingerprintSource = `${name}|${message}|${stack || ''}`;
  const fingerprint = crypto.createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16);

  return {
    name,
    message,
    stack,
    fingerprint
  };
}

function writeLog(level, event, payload = {}) {
  const record = {
    ts: new Date().toISOString(),
    level,
    event,
    payload: redact(payload)
  };

  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

async function reportExternal(record) {
  if (!ERROR_MONITOR_WEBHOOK_URL || typeof fetch !== 'function') return;

  try {
    const controller = new AbortController();
    const timeout = Number.isFinite(ERROR_MONITOR_TIMEOUT_MS) && ERROR_MONITOR_TIMEOUT_MS > 0
      ? ERROR_MONITOR_TIMEOUT_MS
      : 3000;
    const timer = setTimeout(() => controller.abort(), timeout);

    await fetch(ERROR_MONITOR_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(record),
      signal: controller.signal
    });

    clearTimeout(timer);
  } catch (error) {
    const monitorError = serializeError(error, false);
    console.warn(JSON.stringify({
      ts: new Date().toISOString(),
      level: 'warn',
      event: 'error-monitor-delivery-failed',
      payload: monitorError
    }));
  }
}

function captureError(event, error, context = {}) {
  const serializedError = serializeError(error);
  const record = {
    ts: new Date().toISOString(),
    level: 'error',
    event,
    payload: redact({
      error: serializedError,
      context
    })
  };

  console.error(JSON.stringify(record));
  void reportExternal(record);
}

module.exports = {
  writeLog,
  captureError,
  serializeError,
  redact,
  sanitizeString
};