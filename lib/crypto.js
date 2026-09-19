import crypto from 'node:crypto';
import { env } from './env.js';

/**
 * AES-256-GCM encryption for OAuth credentials at rest.
 *
 * Stored format: v1.<iv-b64>.<tag-b64>.<ciphertext-b64>
 * The version prefix lets us rotate the algorithm or key without a migration
 * that has to guess how existing rows were written.
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function key() {
  return Buffer.from(env().ENCRYPTION_KEY, 'base64');
}

export function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decrypt(payload) {
  if (payload == null) return null;
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Cannot decrypt value: unrecognized ciphertext format');
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** Constant-time comparison that tolerates differing lengths. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) {
    // Still burn a comparison so length isn't leaked through timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Stable hash of a source row, used to skip unchanged rows. */
export function hashRow(value) {
  const normalized = typeof value === 'string' ? value : JSON.stringify(value);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/** Signs a short-lived state payload for OAuth round-trips. */
export function signState(payload, ttlSeconds = 600) {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 }),
    'utf8'
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', env().APP_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verifies and decodes a state token. Returns null when invalid or expired. */
export function verifyState(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', env().APP_SECRET).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
