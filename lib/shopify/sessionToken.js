import { jwtVerify } from 'jose';
import { env } from '../env.js';

/**
 * Verification of the App Bridge session token (ID token).
 *
 * The token is signed by Shopify with the app's client secret (HS256). It is
 * the only trustworthy source of the shop identity for an embedded request —
 * a `shop` query parameter or header supplied by the browser is never trusted.
 */

const LEEWAY_SECONDS = 10;

function secretKey() {
  return new TextEncoder().encode(env().SHOPIFY_API_SECRET);
}

export class SessionTokenError extends Error {
  constructor(message, code = 'invalid_session_token') {
    super(message);
    this.name = 'SessionTokenError';
    this.code = code;
  }
}

/**
 * Verifies a session token and returns its claims plus the derived shop domain.
 * Throws SessionTokenError when the token is missing, expired or malformed.
 */
export async function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    throw new SessionTokenError('Missing session token', 'missing_session_token');
  }

  const { SHOPIFY_API_KEY } = env();

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secretKey(), {
      algorithms: ['HS256'],
      audience: SHOPIFY_API_KEY,
      clockTolerance: LEEWAY_SECONDS,
    }));
  } catch (error) {
    throw new SessionTokenError(`Session token rejected: ${error.code || error.message}`);
  }

  // `dest` is the authoritative shop origin. `iss` points at the admin host for
  // the same shop; mismatched pairs indicate a replayed or forged token.
  const dest = typeof payload.dest === 'string' ? payload.dest : '';
  const shop = dest.replace(/^https:\/\//, '').replace(/\/$/, '');
  if (!isValidShopDomain(shop)) {
    throw new SessionTokenError('Session token has no valid shop destination');
  }
  if (typeof payload.iss !== 'string' || !payload.iss.startsWith(dest)) {
    throw new SessionTokenError('Session token issuer does not match destination');
  }

  return {
    shop,
    payload,
    // `sub` identifies the staff member for online access.
    userId: payload.sub ? String(payload.sub) : null,
    sessionId: payload.sid ? String(payload.sid) : null,
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
  };
}

/** Pulls the bearer token out of an Authorization header. */
export function extractSessionToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Strict myshopify domain check. Used everywhere a shop string crosses a trust
 * boundary so that a crafted value cannot be turned into an SSRF target.
 */
export function isValidShopDomain(shop) {
  if (typeof shop !== 'string') return false;
  return /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/.test(shop.toLowerCase());
}

export function normalizeShopDomain(shop) {
  if (typeof shop !== 'string') return null;
  const cleaned = shop
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  const withSuffix = cleaned.includes('.') ? cleaned : `${cleaned}.myshopify.com`;
  return isValidShopDomain(withSuffix) ? withSuffix : null;
}
