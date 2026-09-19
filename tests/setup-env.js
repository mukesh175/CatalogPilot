import crypto from 'node:crypto';

/**
 * Shared test environment. Imported by suites that pull in modules which read
 * configuration at call time, so tests never depend on a developer's .env.
 */
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('base64');
process.env.APP_SECRET = 'test-app-secret-value-long-enough';
process.env.APP_URL = 'https://catalogpilot.test';
process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
process.env.SHOPIFY_API_KEY = 'test-api-key';
process.env.SHOPIFY_API_SECRET = 'test-api-secret';
process.env.SHOPIFY_SCOPES = 'read_products,write_products,read_inventory,write_inventory,read_locations';
process.env.SHOPIFY_API_VERSION = '2026-07';
process.env.GOOGLE_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'https://catalogpilot.test/api/auth/google/callback';
process.env.JOB_RUNNER_SECRET = 'job-runner-secret-long-enough';

export const TEST_SHOP = 'test-store.myshopify.com';
