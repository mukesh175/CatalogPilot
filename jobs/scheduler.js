#!/usr/bin/env node
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { dueSources, scheduleNextRun, enqueueJob, JobConflictError, PlanLimitError } from '../services/job-service.js';

/**
 * Scheduler.
 *
 * `sweep()` is the useful part and is called by /api/jobs/run on every Vercel
 * Cron tick. The loop below (`npm run scheduler`) is only for self-hosted
 * deployments that run their own processes.
 *
 * It only enqueues — the runner executes. A source that already has a job in
 * flight is skipped and its next run pushed forward, so a slow sync cannot
 * pile up behind itself.
 */

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 60_000);
let running = true;

export async function sweep(now = new Date()) {
  const sources = await dueSources(now);
  const results = { queued: 0, skipped: 0 };

  for (const source of sources) {
    try {
      await enqueueJob({
        shopId: source.shopId,
        dataSourceId: source.id,
        kind: 'SYNC',
        triggeredBy: 'schedule',
      });
      results.queued += 1;
      logger.info('scheduler.queued', { dataSourceId: source.id, shop: source.shop.domain });
    } catch (error) {
      results.skipped += 1;
      if (error instanceof JobConflictError) {
        logger.info('scheduler.skipped_in_flight', { dataSourceId: source.id });
      } else if (error instanceof PlanLimitError) {
        // Pause rather than retry every minute against a plan that cannot run.
        await prisma.dataSource.update({
          where: { id: source.id },
          data: { schedule: 'MANUAL', nextRunAt: null },
        });
        logger.warn('scheduler.plan_limit', { dataSourceId: source.id, reason: error.message });
        continue;
      } else {
        logger.error('scheduler.enqueue_failed', { dataSourceId: source.id, error });
      }
    }

    await scheduleNextRun(source.id, source.schedule, now);
  }

  return results;
}

async function main() {
  logger.info('scheduler.started', { tickMs: TICK_MS });

  while (running) {
    try {
      const result = await sweep();
      if (result.queued) logger.info('scheduler.tick', result);
    } catch (error) {
      logger.error('scheduler.tick_failed', { error });
    }
    await new Promise((resolve) => setTimeout(resolve, TICK_MS));
  }

  await prisma.$disconnect();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('scheduler.shutdown_requested', { signal });
    running = false;
  });
}

// Only run the loop when invoked directly; the sweep is also imported by the
// cron HTTP endpoint.
if (process.argv[1] && process.argv[1].endsWith('scheduler.js')) {
  main().catch((error) => {
    logger.error('scheduler.fatal', { error });
    process.exit(1);
  });
}
