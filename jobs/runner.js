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

export async function runJob(jobId, { workerId = WORKER_ID } = {}) {
  const job = await claimJob(jobId, workerId);
  if (!job) {
    logger.debug('runner.job_not_claimable', { jobId });
    return { claimed: false };
  }

  const log = logger.child({ jobId, shopId: job.shopId, shop: job.shop.domain, kind: job.kind });
  const startedAt = Date.now();

  try {
    if (job.kind === 'PREVIEW') {
      const summary = await buildPlan(job, { workerId });
      const finished = await completeJob(jobId, { status: 'COMPLETED' });
      log.info('runner.preview_complete', { durationMs: Date.now() - startedAt, ...summary });
      return { claimed: true, status: finished.status, summary };
    }

    // A sync always plans first: the plan is what the apply step replays, and
    // re-planning here is what makes a re-run of a partially applied job safe.
    const hasPlan = await prisma.syncJobItem.count({ where: { syncJobId: jobId } });
    if (hasPlan === 0) await buildPlan(job, { workerId });

    const counts = await applyPlan(job, { workerId });
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

/** Drains the queue, one job at a time. Returns the number of jobs run. */
export async function drainQueue({ max = 10 } = {}) {
  await releaseStaleJobs();

  let ran = 0;
  for (let i = 0; i < max; i += 1) {
    const next = await prisma.syncJob.findFirst({
      where: { status: 'QUEUED', lockedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) break;
    const result = await runJob(next.id);
    if (result.claimed) ran += 1;
  }
  return ran;
}
