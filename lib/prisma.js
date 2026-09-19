import { PrismaClient } from '@prisma/client';

/**
 * Single Prisma client per process. Next.js dev reloads modules on every
 * change, so the client is cached on globalThis to avoid exhausting the
 * Postgres connection pool.
 */

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.__catalogpilotPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__catalogpilotPrisma = prisma;
}

export default prisma;
