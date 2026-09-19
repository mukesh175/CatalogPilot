/**
 * Structured server-side logging.
 *
 * Nothing sensitive reaches the log stream: token-shaped values and known
 * secret keys are redacted before serialization, and free-form strings are
 * scrubbed for Shopify/Google token prefixes.
 */

const SECRET_KEYS = new Set([
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'idtoken',
  'id_token',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'apisecret',
  'api_secret',
  'authorization',
  'cookie',
  'hmac',
  'signature',
  'encryptionkey',
  'x-shopify-access-token',
]);

const TOKEN_PATTERNS = [
  /shpat_[A-Za-z0-9]+/g,
  /shpca_[A-Za-z0-9]+/g,
  /shpss_[A-Za-z0-9]+/g,
  /ya29\.[A-Za-z0-9_\-.]+/g,
  /1\/\/[A-Za-z0-9_\-.]{20,}/g,
  /eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g,
];

const REDACTED = '[redacted]';

function scrubString(value) {
  let out = value;
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

export function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 6) return '[depth-limit]';
  if (typeof value === 'string') return scrubString(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), code: value.code };
  }
  const out = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : redact(val, depth + 1);
  }
  return out;
}

function emit(level, message, context) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...redact(context || {}),
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg, ctx) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', msg, ctx);
  },
  info: (msg, ctx) => emit('info', msg, ctx),
  warn: (msg, ctx) => emit('warn', msg, ctx),
  error: (msg, ctx) => emit('error', msg, ctx),

  /** Returns a logger that stamps every line with the given context. */
  child(base) {
    return {
      debug: (msg, ctx) => logger.debug(msg, { ...base, ...ctx }),
      info: (msg, ctx) => logger.info(msg, { ...base, ...ctx }),
      warn: (msg, ctx) => logger.warn(msg, { ...base, ...ctx }),
      error: (msg, ctx) => logger.error(msg, { ...base, ...ctx }),
      child: (more) => logger.child({ ...base, ...more }),
    };
  },
};

/** Times an async operation and logs duration + status. */
export async function timed(log, operation, fn, context = {}) {
  const start = Date.now();
  try {
    const result = await fn();
    log.info(operation, { ...context, durationMs: Date.now() - start, status: 'ok' });
    return result;
  } catch (error) {
    log.error(operation, {
      ...context,
      durationMs: Date.now() - start,
      status: 'error',
      errorCode: error?.code || error?.name,
      error,
    });
    throw error;
  }
}
