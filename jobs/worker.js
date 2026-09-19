#!/usr/bin/env node
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { runJob, releaseStaleJobs, WORKER_ID } from './runner.js';

/**
 * Long-running worker process: `npm run worker`.
 *
 * Polls for queued jobs. Deployments that prefer a serverless model can skip
 * this entirely and drive /api/jobs/run from their own scheduler instead.
 */

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS || 5000);
const STALE_SWEEP_MS = 5 * 60 * 1000;

let running = true;
let lastSweep = 0;

async function tick() {
  if (Date.now() - lastSweep > STALE_SWEEP_MS) {
    await releaseStaleJobs();
    lastSweep = Date.now();
  }

  const next = await prisma.syncJob.findFirst({
    where: { status: 'QUEUED', lockedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!next) return false;

  await runJob(next.id);
  return true;
}

async function main() {
  logger.info('worker.started', { workerId: WORKER_ID, pollMs: POLL_INTERVAL_MS });

  while (running) {
    try {
      const didWork = await tick();
      if (!didWork) await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      // A failure in the polling loop itself must not kill the worker.
      logger.error('worker.tick_failed', { error });
      await sleep(POLL_INTERVAL_MS);
    }
  }

  await prisma.$disconnect();
  logger.info('worker.stopped', { workerId: WORKER_ID });
  process.exit(0);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('worker.shutdown_requested', { signal });
    running = false;
  });
}

main().catch((error) => {
  logger.error('worker.fatal', { error });
  process.exit(1);
});
