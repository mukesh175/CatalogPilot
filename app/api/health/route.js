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
  let databaseError = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = true;
  } catch (error) {
    checks.database = false;
    // PrismaClientInitializationError carries its code on `errorCode`, not
    // `code` — reading only `code` hides exactly the detail that identifies
    // the cause.
    const code = error?.errorCode || error?.code || null;
    databaseError = {
      code: code || error?.name || 'unknown',
      hint: databaseHint(code, error),
      detail: sanitize(error?.message),
    };
  }

  const healthy = Object.values(checks).every(Boolean);
  return json(
    {
      status: healthy ? 'ok' : 'degraded',
      checks,
      ...(databaseError ? { database: databaseError } : {}),
    },
    { status: healthy ? 200 : 503 }
  );
}

/**
 * A short, safe excerpt of the driver's own message.
 *
 * Credentials are stripped first: a connection error frequently quotes the URL
 * back, and that URL contains the database password.
 */
function sanitize(message) {
  if (!message) return null;
  return String(message)
    .replace(/\/\/[^@\s]+@/g, '//[credentials]@')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Turns a Prisma connection error into the thing to go and check. */
function databaseHint(code, error) {
  // Prisma does not always attach a code to an initialization failure, so the
  // message is the only signal left.
  if (!code && /scheme is not recognized|invalid.*connection string/i.test(error?.message || '')) {
    return 'DATABASE_URL is malformed. It must begin with postgresql:// exactly — check for a stray character at the start.';
  }

  switch (code) {
    case 'P1000':
      return 'The database rejected the username or password in DATABASE_URL.';
    case 'P1001':
      return 'The database host in DATABASE_URL is unreachable. Check the host name and that the Neon project is not deleted.';
    case 'P1002':
    case 'P1008':
      return 'The database did not answer in time. A Neon compute that has scaled to zero needs connect_timeout=15 in DATABASE_URL.';
    case 'P1003':
      return 'That database name does not exist on the server.';
    case 'P1013':
      return 'DATABASE_URL is malformed. It must begin with postgresql:// exactly.';
    default:
      return 'Check DATABASE_URL, and that migrations have been applied.';
  }
}
