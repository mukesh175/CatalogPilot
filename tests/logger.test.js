import { describe, it, expect } from 'vitest';
import { redact } from '../lib/logger.js';

/**
 * Secrets must not reach the log stream even when a whole object is passed
 * through by accident, so redaction is tested at every level it can hide.
 */

describe('redact', () => {
  it('removes known secret keys', () => {
    const result = redact({
      shop: 'store.myshopify.com',
      accessToken: 'shpat_abc123',
      refresh_token: '1//very-secret-value-here',
      password: 'hunter2',
    });

    expect(result.shop).toBe('store.myshopify.com');
    expect(result.accessToken).toBe('[redacted]');
    expect(result.refresh_token).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
  });

  it('scrubs token-shaped values out of free text', () => {
    const result = redact({
      message: 'Request failed with token shpat_0123456789abcdef and ya29.a0AfB_xyz123',
    });
    expect(result.message).not.toMatch(/shpat_/);
    expect(result.message).not.toMatch(/ya29\./);
    expect(result.message).toMatch(/\[redacted\]/);
  });

  it('scrubs a JWT out of free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop';
    expect(redact(`Bearer ${jwt}`)).not.toContain(jwt);
  });

  it('redacts nested objects', () => {
    const result = redact({ session: { shop: 'x', accessToken: 'shpat_secret' } });
    expect(result.session.accessToken).toBe('[redacted]');
  });

  it('redacts inside arrays', () => {
    const result = redact({ sessions: [{ accessToken: 'shpat_one' }, { accessToken: 'shpat_two' }] });
    expect(result.sessions[0].accessToken).toBe('[redacted]');
    expect(result.sessions[1].accessToken).toBe('[redacted]');
  });

  it('matches secret keys regardless of case', () => {
    expect(redact({ AccessToken: 'x', AUTHORIZATION: 'y' })).toEqual({
      AccessToken: '[redacted]',
      AUTHORIZATION: '[redacted]',
    });
  });

  it('reduces an Error to safe fields', () => {
    const error = new Error('Failed with shpat_secret_token');
    const result = redact(error);
    expect(result.name).toBe('Error');
    expect(result.message).not.toContain('shpat_secret_token');
    expect(result.stack).toBeUndefined();
  });

  it('stops at a depth limit rather than recursing forever', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: 'deep' } } } } } } } };
    expect(() => redact(deep)).not.toThrow();
  });

  it('passes primitives through untouched', () => {
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBeNull();
  });
});
