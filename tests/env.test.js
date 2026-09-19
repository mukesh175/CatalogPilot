import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * Environment validation, including the case that actually bites in
 * deployment: a variable that exists but is blank.
 */

const BASE = {
  NODE_ENV: 'production',
  APP_URL: 'https://catalogpilot.vercel.app',
  DATABASE_URL: 'postgresql://u:p@ep-x-pooler.eu-west-2.aws.neon.tech/db?sslmode=require',
  DIRECT_URL: 'postgresql://u:p@ep-x.eu-west-2.aws.neon.tech/db?sslmode=require',
  ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  APP_SECRET: 'a-long-enough-app-secret-value',
  SHOPIFY_API_KEY: 'key',
  SHOPIFY_API_SECRET: 'secret',
  SHOPIFY_SCOPES: 'read_products,write_products',
  SHOPIFY_API_VERSION: '2026-07',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  GOOGLE_REDIRECT_URI: 'https://catalogpilot.vercel.app/api/auth/google/callback',
  CRON_SECRET: 'vercel-cron-secret-value-ok',
};

const saved = { ...process.env };

function apply(overrides = {}) {
  for (const key of Object.keys(BASE)) delete process.env[key];
  delete process.env.JOB_RUNNER_SECRET;
  delete process.env.SMTP_URL;
  delete process.env.NOTIFICATION_FROM_EMAIL;
  Object.assign(process.env, BASE, overrides);
}

async function freshEnv() {
  // The module caches after the first successful parse, so each case needs the
  // module registry cleared before it is imported again.
  vi.resetModules();
  return import('../lib/env.js');
}

beforeEach(() => apply());

afterEach(() => {
  process.env = { ...saved };
});

describe('env validation', () => {
  it('accepts a complete Vercel + Neon configuration', async () => {
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(true);
  });

  it('treats a declared-but-blank optional variable as unset', async () => {
    // This is the deployment case: JOB_RUNNER_SECRET listed in .env with no
    // value, or added in Vercel with an empty value.
    apply({ JOB_RUNNER_SECRET: '', SMTP_URL: '', NOTIFICATION_FROM_EMAIL: '' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(true);
  });

  it('accepts JOB_RUNNER_SECRET alone, without CRON_SECRET', async () => {
    apply({ CRON_SECRET: '', JOB_RUNNER_SECRET: 'manual-runner-secret-value' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(true);
  });

  it('rejects a configuration with no way to trigger jobs', async () => {
    apply({ CRON_SECRET: '', JOB_RUNNER_SECRET: '' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(false);
  });

  it('rejects a job secret that is too short to be worth having', async () => {
    apply({ CRON_SECRET: 'short' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(false);
  });

  it('rejects an encryption key that is not 32 bytes', async () => {
    apply({ ENCRYPTION_KEY: Buffer.from('too-short').toString('base64') });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(false);
  });

  it('rejects a missing database URL', async () => {
    apply({ DATABASE_URL: '' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(false);
  });

  it('does not require DIRECT_URL at runtime — only the Prisma CLI reads it', async () => {
    apply({ DIRECT_URL: '' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(true);
  });

  it('rejects a malformed API version', async () => {
    apply({ SHOPIFY_API_VERSION: 'latest' });
    const { envIsConfigured } = await freshEnv();
    expect(envIsConfigured()).toBe(false);
  });

  it('names the offending variables when env() throws', async () => {
    apply({ APP_URL: 'not-a-url' });
    const { env } = await freshEnv();
    expect(() => env()).toThrow(/APP_URL/);
  });
});
