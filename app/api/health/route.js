import prisma from '../../../lib/prisma.js';
import { envIsConfigured } from '../../../lib/env.js';
import { json } from '../../../lib/api.js';

/**
 * Liveness/readiness probe.
 * Reports whether configuration and the database are usable, without leaking
 * any value from the environment.
 */
export async function GET() {
  const checks = { env: envIsConfigured(), database: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {
    checks.database = false;
  }

  const healthy = Object.values(checks).every(Boolean);
  return json(
    { status: healthy ? 'ok' : 'degraded', checks, version: process.env.npm_package_version || null },
    { status: healthy ? 200 : 503 }
  );
}
