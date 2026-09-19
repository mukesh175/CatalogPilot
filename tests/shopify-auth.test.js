import './setup-env.js';
import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import {
  verifySessionToken,
  extractSessionToken,
  isValidShopDomain,
  normalizeShopDomain,
  SessionTokenError,
} from '../lib/shopify/sessionToken.js';

/**
 * Session token verification is the app's only source of shop identity, so it
 * is tested against forged, expired and mismatched tokens rather than just the
 * happy path.
 */

const SHOP = 'test-store.myshopify.com';
const secret = () => new TextEncoder().encode(process.env.SHOPIFY_API_SECRET);

async function makeToken({
  shop = SHOP,
  audience = process.env.SHOPIFY_API_KEY,
  expiresIn = 60,
  issuer,
  signingSecret,
  sub = '42',
} = {}) {
  const dest = `https://${shop}`;
  return new SignJWT({
    dest,
    iss: issuer ?? `${dest}/admin`,
    sub,
    sid: 'session-id',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingSecret || secret());
}

describe('verifySessionToken', () => {
  it('accepts a valid token and derives the shop', async () => {
    const result = await verifySessionToken(await makeToken());
    expect(result.shop).toBe(SHOP);
    expect(result.userId).toBe('42');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await makeToken({ signingSecret: new TextEncoder().encode('wrong-secret-entirely') });
    await expect(verifySessionToken(token)).rejects.toThrow(SessionTokenError);
  });

  it('rejects an expired token', async () => {
    const token = await makeToken({ expiresIn: -120 });
    await expect(verifySessionToken(token)).rejects.toThrow(SessionTokenError);
  });

  it('rejects a token issued for a different app', async () => {
    const token = await makeToken({ audience: 'someone-elses-api-key' });
    await expect(verifySessionToken(token)).rejects.toThrow(SessionTokenError);
  });

  it('rejects a token whose issuer does not match its destination', async () => {
    const token = await makeToken({ issuer: 'https://attacker.myshopify.com/admin' });
    await expect(verifySessionToken(token)).rejects.toThrow(/issuer/i);
  });

  it('rejects a destination that is not a myshopify domain', async () => {
    const token = await makeToken({ shop: 'evil.example.com' });
    await expect(verifySessionToken(token)).rejects.toThrow(/shop destination/i);
  });

  it('rejects a missing token', async () => {
    await expect(verifySessionToken(null)).rejects.toThrow(/Missing session token/);
  });
});

describe('extractSessionToken', () => {
  const request = (headers) => new Request('https://catalogpilot.test/api/x', { headers });

  it('reads a bearer token', () => {
    expect(extractSessionToken(request({ authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
  });

  it('returns null without a bearer header', () => {
    expect(extractSessionToken(request({}))).toBeNull();
    expect(extractSessionToken(request({ authorization: 'Basic abc' }))).toBeNull();
  });
});

describe('isValidShopDomain', () => {
  it('accepts real shop domains', () => {
    expect(isValidShopDomain('my-store.myshopify.com')).toBe(true);
    expect(isValidShopDomain('store123.myshopify.com')).toBe(true);
  });

  it('rejects lookalikes and injection attempts', () => {
    expect(isValidShopDomain('evil.com')).toBe(false);
    expect(isValidShopDomain('shop.myshopify.com.evil.com')).toBe(false);
    expect(isValidShopDomain('shop.myshopify.com/../admin')).toBe(false);
    expect(isValidShopDomain('localhost')).toBe(false);
    expect(isValidShopDomain('')).toBe(false);
    expect(isValidShopDomain(null)).toBe(false);
  });
});

describe('normalizeShopDomain', () => {
  it('adds the suffix and strips protocol and path', () => {
    expect(normalizeShopDomain('my-store')).toBe('my-store.myshopify.com');
    expect(normalizeShopDomain('https://my-store.myshopify.com/admin')).toBe('my-store.myshopify.com');
    expect(normalizeShopDomain('  MY-STORE.myshopify.com ')).toBe('my-store.myshopify.com');
  });

  it('returns null for anything that is not a shop', () => {
    expect(normalizeShopDomain('evil.com')).toBeNull();
    expect(normalizeShopDomain(null)).toBeNull();
  });
});
