import crypto from 'node:crypto';
import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { SCHEDULE_INTERVALS } from '../lib/plans.js';
import { checkEntitlement } from './billing.js';

/**
 * Job lifecycle.
 *
 * Two invariants matter here:
 *  - one running job per data source, enforced by a check plus a unique
 *    idempotency key rather than by hoping the UI behaves;
 *  - a queued job is safe to enqueue twice — the second call returns the
 *    existing job instead of creating a duplicate.
 */

export class JobConflictError extends Error {
  constructor(message, existingJobId) {
    super(message);
    this.name = 'JobConflictError';
    this.code = 'job_in_progress';
    this.existingJobId = existingJobId;
  }
}

export class PlanLimitError extends Error {
  constructor(message, upgradeTo) {
    super(message);
    this.name = 'PlanLimitError';
    this.code = 'plan_limit';
    this.upgradeTo = upgradeTo;
  }
}

const ACTIVE_STATUSES = ['QUEUED', 'RUNNING'];

/**
 * Enqueues a preview or sync job.
 * `idempotencyKey` defaults to a value derived from the source and a coarse
 * time bucket, so a double-clicked button cannot create two runs.
 */
export async function enqueueJob({
  shopId,
  dataSourceId,
  kind = 'SYNC',
  triggeredBy = 'manual',
  idempotencyKey,
}) {
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    include: { sheets: { where: { isSelected: true }, take: 1 }, mappings: true },
  });
  if (!source) throw new Error('That data source does not exist');

  const running = await prisma.syncJob.findFirst({
    where: { dataSourceId, status: { in: ACTIVE_STATUSES } },
    select: { id: true, kind: true },
  });
  if (running) {
    throw new JobConflictError(
      `A ${running.kind.toLowerCase()} is already running for this source.`,
      running.id
    );
  }

  if (kind === 'SYNC') {
    const rowEstimate = source.sheets[0]?.rowCount || 0;
    const entitlement = await checkEntitlement(shopId, 'sync_products', { count: rowEstimate });
    if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);
  }

  const key =
    idempotencyKey ||
    crypto
      .createHash('sha256')
      .update(`${dataSourceId}:${kind}:${Math.floor(Date.now() / 10_000)}`)
      .digest('hex');

  const existing = await prisma.syncJob.findUnique({ where: { idempotencyKey: key } });
  if (existing) return existing;

  const job = await prisma.syncJob.create({
    data: { shopId, dataSourceId, kind, triggeredBy, idempotencyKey: key, status: 'QUEUED' },
  });

  logger.info('job.enqueued', { jobId: job.id, shopId, kind, triggeredBy });
  return job;
}

/** Requests cancellation; the worker checks this between rows. */
export async function requestCancel({ shopId, jobId }) {
  const { count } = await prisma.syncJob.updateMany({
    where: { id: jobId, shopId, status: { in: ACTIVE_STATUSES } },
    data: { cancelRequested: true },
  });
  if (count === 0) return null;
  logger.info('job.cancel_requested', { jobId, shopId });
  return prisma.syncJob.findUnique({ where: { id: jobId } });
}

/** Jobs due to run on their schedule. */
export async function dueSources(now = new Date()) {
  return prisma.dataSource.findMany({
    where: {
      isPaused: false,
      status: 'READY',
      schedule: { not: 'MANUAL' },
      nextRunAt: { lte: now },
      shop: { isActive: true },
    },
    include: { shop: { select: { id: true, domain: true } } },
    take: 50,
  });
}

/** Advances nextRunAt after a scheduled run is queued. */
export async function scheduleNextRun(dataSourceId, schedule, from = new Date()) {
  const interval = SCHEDULE_INTERVALS[schedule];
  if (!interval) {
    return prisma.dataSource.update({ where: { id: dataSourceId }, data: { nextRunAt: null } });
  }
  return prisma.dataSource.update({
    where: { id: dataSourceId },
    data: { nextRunAt: new Date(from.getTime() + interval) },
  });
}

/** Sets a source's schedule, validating it against the plan. */
export async function setSchedule({ shopId, dataSourceId, schedule }) {
  const entitlement = await checkEntitlement(shopId, 'schedule', { schedule });
  if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);

  const interval = SCHEDULE_INTERVALS[schedule];
  return prisma.dataSource.update({
    where: { id: dataSourceId },
    data: {
      schedule,
      nextRunAt: interval ? new Date(Date.now() + interval) : null,
    },
  });
}

/** The next job a worker should pick up, oldest first. */
export async function nextQueuedJob() {
  return prisma.syncJob.findFirst({
    where: { status: 'QUEUED', lockedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
}

/** Progress payload for the sync progress UI. */
export async function jobProgress({ shopId, jobId }) {
  const job = await prisma.syncJob.findFirst({
    where: { id: jobId, shopId },
    include: {
      dataSource: { select: { id: true, name: true } },
      _count: { select: { errors: true } },
    },
  });
  if (!job) return null;

  const percent =
    job.totalRows > 0 ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)) : 0;

  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    percent,
    processed: job.processedRows,
    total: job.totalRows,
    created: job.createdCount,
    updated: job.updatedCount,
    unchanged: job.unchangedCount,
    skipped: job.skippedCount,
    failed: job.failedCount,
    errorCount: job._count.errors,
    source: job.dataSource,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    cancelRequested: job.cancelRequested,
  };
}
