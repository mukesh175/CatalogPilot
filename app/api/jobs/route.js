import prisma from '../../../lib/prisma.js';
import { withAuth, json, apiError, parseBody } from '../../../lib/api.js';
import { startJobSchema } from '../../../validators/index.js';
import { enqueueJob, JobConflictError, PlanLimitError } from '../../../services/job-service.js';
import { validateMappingSet } from '../../../services/mapping-engine.js';
import { runJob } from '../../../jobs/runner.js';
import { logger } from '../../../lib/logger.js';

/** Recent jobs for the sync center. */
export const GET = withAuth(async (request, { shopId }) => {
  const jobs = await prisma.syncJob.findMany({
    where: { shopId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { dataSource: { select: { id: true, name: true } }, _count: { select: { errors: true } } },
  });

  return json({
    jobs: jobs.map((job) => ({
      id: job.id,
      kind: job.kind,
      status: job.status,
      source: job.dataSource,
      total: job.totalRows,
      processed: job.processedRows,
      created: job.createdCount,
      updated: job.updatedCount,
      unchanged: job.unchangedCount,
      failed: job.failedCount,
      errorCount: job._count.errors,
      triggeredBy: job.triggeredBy,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    })),
  });
});

/**
 * Starts a preview or a sync.
 *
 * A sync is refused unless the mapping set is complete — the merchant is sent
 * back to the mapping step rather than discovering the problem row by row.
 */
export const POST = withAuth(async (request, { shopId, log }) => {
  const { dataSourceId, kind } = await parseBody(request, startJobSchema);

  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    include: { mappings: true, sheets: { where: { isSelected: true }, take: 1 } },
  });
  if (!source) return apiError('That data source could not be found.', { status: 404, code: 'not_found' });
  if (!source.sheets[0]) {
    return apiError('Choose a worksheet before running a sync.', { status: 409, code: 'no_worksheet' });
  }

  const validation = validateMappingSet(source.mappings);
  if (!validation.ok) {
    return apiError('Finish mapping your columns before running a sync.', {
      status: 409,
      code: 'mappings_incomplete',
      details: validation,
    });
  }

  try {
    const job = await enqueueJob({ shopId, dataSourceId, kind, triggeredBy: 'manual' });

    // Kick the worker without blocking the response. A deployment running the
    // standalone worker will simply find the job already claimed.
    runJob(job.id).catch((error) => log.error('jobs.inline_run_failed', { jobId: job.id, error }));

    return json({ job: { id: job.id, kind: job.kind, status: job.status } }, { status: 202 });
  } catch (error) {
    if (error instanceof JobConflictError) {
      return apiError(error.message, {
        status: 409,
        code: 'job_in_progress',
        details: { jobId: error.existingJobId },
      });
    }
    if (error instanceof PlanLimitError) {
      return apiError(error.message, { status: 402, code: 'plan_limit', details: { upgradeTo: error.upgradeTo } });
    }
    throw error;
  }
});
