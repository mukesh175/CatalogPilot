import './setup-env.js';
import { describe, it, expect, afterEach } from 'vitest';
import { googleOAuthEnabled } from '../lib/google/oauth.js';

/**
 * Google sign-in stays hidden until Google verifies the app.
 *
 * The flag is checked on the server as well as in the UI, so a cached page or
 * a direct call cannot start a consent flow that Google will only block.
 */

const saved = process.env.GOOGLE_OAUTH_ENABLED;

afterEach(() => {
  if (saved === undefined) delete process.env.GOOGLE_OAUTH_ENABLED;
  else process.env.GOOGLE_OAUTH_ENABLED = saved;
});

describe('googleOAuthEnabled', () => {
  it('is off when the variable is unset', () => {
    delete process.env.GOOGLE_OAUTH_ENABLED;
    expect(googleOAuthEnabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    process.env.GOOGLE_OAUTH_ENABLED = 'true';
    expect(googleOAuthEnabled()).toBe(true);
  });

  it('stays off for values that merely look enabled', () => {
    for (const value of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env.GOOGLE_OAUTH_ENABLED = value;
      expect(googleOAuthEnabled()).toBe(false);
    }
  });
});
