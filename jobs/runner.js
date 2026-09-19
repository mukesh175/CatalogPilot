import crypto from 'node:crypto';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { claimJob, buildPlan, applyPlan, completeJob, releaseStaleJobs } from '../services/sync-engine.js';
import { describeError } from '../services/error-center.js';
import { notify } from '../services/notifications.js';

/**
 * Runs a single job to completion.
 *
 * Shared by the standalone worker and the HTTP trigger so both code paths have
 * identical semantics — the only difference is what decides when to call it.
 */

export const WORKER_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

/**
 * Runs a job, optionally under a wall-clock deadline.
 *
 * The deadline is what makes this safe on a serverless host. A Vercel function
 * is killed at its `maxDuration`, so a long sync must be able to stop of its
 * own accord, hand the job back to the queue, and let the next invocation pick
 * up where it left off. Items already applied are marked APPLIED, so resuming
 * never re-applies them.
 */
export async function runJob(jobId, { workerId = WORKER_ID, deadline = null } = {}) {
  const job = await claimJob(jobId, workerId);
  if (!job) {
    logger.debug('runner.job_not_claimable', { jobId });
    return { claimed: false };
  }

  const log = logger.child({ jobId, shopId: job.shopId, shop: job.shop.domain, kind: job.kind });
  const startedAt = Date.now();

  try {
    if (job.kind === 'PREVIEW') {
      const summary = await buildPlan(job, { workerId, deadline });
      if (summary.incomplete) return yieldJob(jobId, log, startedAt, 'preview');
      const finished = await completeJob(jobId, { status: 'COMPLETED' });
      log.info('runner.preview_complete', { durationMs: Date.now() - startedAt, ...summary });
      return { claimed: true, status: finished.status, summary };
    }

    // A sync always plans first: the plan is what the apply step replays, and
    // re-planning here is what makes a re-run of a partially applied job safe.
    if (!job.planCompletedAt) {
      const summary = await buildPlan(job, { workerId, deadline });
      if (summary.incomplete) return yieldJob(jobId, log, startedAt, 'plan');
    }

    const counts = await applyPlan(job, { workerId, deadline });
    if (counts.incomplete) return yieldJob(jobId, log, startedAt, 'apply');

    const finished = await completeJob(jobId);

    const durationMs = Date.now() - startedAt;
    log.info('runner.sync_complete', { durationMs, ...counts });

    await sendCompletionNotice(job, finished, counts, durationMs);
    return { claimed: true, status: finished.status, counts };
  } catch (error) {
    const described = describeError(error, {});
    log.error('runner.job_failed', { error, code: described.code });

    await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        message: described.message,
      },
    });
    await prisma.syncError.create({
      data: {
        syncJobId: jobId,
        kind: described.kind || 'UNKNOWN',
        code: described.code || null,
        message: described.message,
        suggestion: described.suggestion || null,
        isRetryable: described.isRetryable ?? true,
      },
    });
    await completeJob(jobId, { status: 'FAILED' });

    await notify(job.shopId, 'sync_failed', {
      sourceName: job.dataSource.name,
      message: described.message,
    });

    return { claimed: true, status: 'FAILED', error: described };
  }
}

/**
 * Hands a partially processed job back to the queue.
 *
 * The lock is released and the status returns to QUEUED, so the next cron tick
 * claims it and continues. Progress counters are left as they are — they are
 * cumulative across invocations.
 */
async function yieldJob(jobId, log, startedAt, phase) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });
  log.info('runner.yielded', { phase, durationMs: Date.now() - startedAt });
  return { claimed: true, status: 'QUEUED', incomplete: true, phase };
}

async function sendCompletionNotice(job, finished, counts, durationMs) {
  if (finished.status === 'COMPLETED_WITH_ERRORS' && counts.failed > 0) {
    await notify(job.shopId, 'attention_required', {
      sourceName: job.dataSource.name,
      count: counts.failed,
    });
    return;
  }
  await notify(job.shopId, 'sync_completed', {
    sourceName: job.dataSource.name,
    durationMs,
    scanned: finished.totalRows,
    created: counts.created,
    updated: counts.updated,
    unchanged: finished.unchangedCount,
    failed: counts.failed,
  });
}

/**
 * Drains the queue until it is empty or the deadline is reached.
 * Returns what happened, so the cron endpoint can report it.
 */
export async function drainQueue({ max = 10, deadline = null } = {}) {
  await releaseStaleJobs();

  let ran = 0;
  let yielded = 0;

  for (let i = 0; i < max; i += 1) {
    if (deadline && Date.now() >= deadline) break;

    const next = await prisma.syncJob.findFirst({
      where: { status: 'QUEUED', lockedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) break;

    const result = await runJob(next.id, { deadline });
    if (result.claimed) ran += 1;
    if (result.incomplete) {
      // The job needs another invocation. Stop here rather than starting a new
      // job we have no time budget left for.
      yielded += 1;
      break;
    }
  }

  return { ran, yielded };
}
