import { z } from 'zod';

/**
 * Server-only environment access. Importing this from a client component will
 * throw at build time, which is deliberate — secrets must never be bundled.
 */

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),

  ENCRYPTION_KEY: z
    .string()
    .min(1, 'ENCRYPTION_KEY is required')
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'ENCRYPTION_KEY must be 32 bytes, base64 encoded',
    }),
  APP_SECRET: z.string().min(16),

  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_SCOPES: z.string().min(1),
  SHOPIFY_API_VERSION: z.string().regex(/^\d{4}-\d{2}$/),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),

  JOB_RUNNER_SECRET: z.string().min(16),

  SMTP_URL: z.string().optional(),
  NOTIFICATION_FROM_EMAIL: z.string().optional(),
});

let cached = null;

/**
 * Parsed env, validated on first access rather than at import time so that
 * `next build` can compile pages without a fully populated .env.
 */
export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

/** True when every required variable is present — used by the health check. */
export function envIsConfigured() {
  return schema.safeParse(process.env).success;
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/** Host without protocol, used for Shopify redirect URLs and CSP. */
export function appHost() {
  return new URL(env().APP_URL).host;
}
