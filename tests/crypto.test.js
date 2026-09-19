import { describe, it, expect, beforeAll } from 'vitest';
import crypto from 'node:crypto';

/**
 * Crypto is exercised against a real key, set before the module under test is
 * imported so lib/env picks it up.
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  process.env.APP_SECRET = 'test-app-secret-value-long-enough';
  process.env.APP_URL = 'https://example.com';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
  process.env.SHOPIFY_API_KEY = 'test-key';
  process.env.SHOPIFY_API_SECRET = 'test-secret';
  process.env.SHOPIFY_SCOPES = 'read_products';
  process.env.SHOPIFY_API_VERSION = '2026-07';
  process.env.GOOGLE_CLIENT_ID = 'google-id';
  process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
  process.env.GOOGLE_REDIRECT_URI = 'https://example.com/cb';
  process.env.JOB_RUNNER_SECRET = 'job-runner-secret-long-enough';
});

describe('encrypt / decrypt', () => {
  it('round-trips a token', async () => {
    const { encrypt, decrypt } = await import('../lib/crypto.js');
    // Assembled at runtime so the repository never contains a literal that
    // a secret scanner reads as a real Shopify access token.
    const token = 'shpat_' + '0123456789abcdef'.repeat(2);
    const sealed = encrypt(token);

    expect(sealed).not.toContain(token);
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(decrypt(sealed)).toBe(token);
  });

  it('produces a different ciphertext each time', async () => {
    const { encrypt } = await import('../lib/crypto.js');
    expect(encrypt('same-value')).not.toBe(encrypt('same-value'));
  });

  it('rejects a tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('../lib/crypto.js');
    const sealed = encrypt('secret');
    const parts = sealed.split('.');
    const corrupted = Buffer.from(parts[3], 'base64');
    corrupted[0] ^= 0xff;
    parts[3] = corrupted.toString('base64');

    expect(() => decrypt(parts.join('.'))).toThrow();
  });

  it('rejects an unrecognized format', async () => {
    const { decrypt } = await import('../lib/crypto.js');
    expect(() => decrypt('not-a-ciphertext')).toThrow(/unrecognized/i);
  });

  it('passes null through', async () => {
    const { encrypt, decrypt } = await import('../lib/crypto.js');
    expect(encrypt(null)).toBeNull();
    expect(decrypt(null)).toBeNull();
  });
});

describe('safeEqual', () => {
  it('compares equal strings', async () => {
    const { safeEqual } = await import('../lib/crypto.js');
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('rejects different strings and lengths without throwing', async () => {
    const { safeEqual } = await import('../lib/crypto.js');
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcdef')).toBe(false);
    expect(safeEqual(undefined, 'abc')).toBe(false);
  });
});

describe('state tokens', () => {
  it('round-trips a signed payload', async () => {
    const { signState, verifyState } = await import('../lib/crypto.js');
    const token = signState({ shopId: 'shop_1', purpose: 'google_connect' });
    const payload = verifyState(token);

    expect(payload.shopId).toBe('shop_1');
    expect(payload.purpose).toBe('google_connect');
  });

  it('rejects a forged signature', async () => {
    const { signState, verifyState } = await import('../lib/crypto.js');
    const token = signState({ shopId: 'shop_1' });
    const [body] = token.split('.');
    expect(verifyState(`${body}.forged-signature`)).toBeNull();
  });

  it('rejects an altered payload', async () => {
    const { signState, verifyState } = await import('../lib/crypto.js');
    const token = signState({ shopId: 'shop_1' });
    const [, signature] = token.split('.');
    const altered = Buffer.from(JSON.stringify({ shopId: 'shop_2', exp: Date.now() + 10000 })).toString(
      'base64url'
    );
    expect(verifyState(`${altered}.${signature}`)).toBeNull();
  });

  it('rejects an expired token', async () => {
    const { signState, verifyState } = await import('../lib/crypto.js');
    const token = signState({ shopId: 'shop_1' }, -1);
    expect(verifyState(token)).toBeNull();
  });

  it('rejects junk', async () => {
    const { verifyState } = await import('../lib/crypto.js');
    expect(verifyState('')).toBeNull();
    expect(verifyState(null)).toBeNull();
    expect(verifyState('no-dot')).toBeNull();
  });
});

describe('hashRow', () => {
  it('is stable for identical rows and differs for changed ones', async () => {
    const { hashRow } = await import('../lib/crypto.js');
    expect(hashRow(['a', 'b'])).toBe(hashRow(['a', 'b']));
    expect(hashRow(['a', 'b'])).not.toBe(hashRow(['a', 'c']));
  });
});
