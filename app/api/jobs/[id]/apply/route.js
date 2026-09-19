import prisma from '../../../../../lib/prisma.js';
import { withAuth, json, apiError } from '../../../../../lib/api.js';
import { enqueueJob, JobConflictError, PlanLimitError } from '../../../../../services/job-service.js';
import { runJob } from '../../../../../jobs/runner.js';
import { kickJob } from '../../../../../lib/background.js';

const BACKGROUND_BUDGET_MS = 280_000;

export const maxDuration = 300;

/**
 * Approves a preview and runs the sync.
 *
 * The approved preview's items are carried over to the new sync job, so what
 * runs is exactly what the merchant saw — not a fresh plan built from a sheet
 * that may have changed in the meantime.
 */
export const POST = withAuth(async (request, { shopId, params }) => {
  const preview = await prisma.syncJob.findFirst({
    where: { id: params.id, shopId, kind: 'PREVIEW' },
    include: { _count: { select: { items: true } } },
  });
  if (!preview) return apiError('That preview could not be found.', { status: 404, code: 'not_found' });
  if (preview.status === 'RUNNING' || preview.status === 'QUEUED') {
    return apiError('This preview is still being built.', { status: 409, code: 'preview_incomplete' });
  }

  const applicable = await prisma.syncJobItem.count({
    where: { syncJobId: preview.id, action: { in: ['CREATE', 'UPDATE'] } },
  });
  if (applicable === 0) {
    return apiError('There is nothing to apply — every row is already up to date.', {
      status: 409,
      code: 'nothing_to_apply',
    });
  }

  try {
    const job = await enqueueJob({
      shopId,
      dataSourceId: preview.dataSourceId,
      kind: 'SYNC',
      triggeredBy: 'manual',
    });

    const items = await prisma.syncJobItem.findMany({
      where: { syncJobId: preview.id, action: { in: ['CREATE', 'UPDATE'] } },
    });

    await prisma.syncJobItem.createMany({
      data: items.map((item) => ({
        syncJobId: job.id,
        rowNumber: item.rowNumber,
        rowHash: item.rowHash,
        sku: item.sku,
        handle: item.handle,
        title: item.title,
        action: item.action,
        status: 'PENDING',
        changes: item.changes,
        warnings: item.warnings,
        shopifyProductId: item.shopifyProductId,
        shopifyVariantId: item.shopifyVariantId,
      })),
      skipDuplicates: true,
    });

    // The approved preview *is* the plan, so the sync job is marked planned.
    // Without this the runner would rebuild the plan and could apply rows the
    // merchant never saw.
    await prisma.syncJob.update({
      where: { id: job.id },
      data: { totalRows: items.length, planCompletedAt: new Date() },
    });

    kickJob(job.id, runJob, { deadline: Date.now() + BACKGROUND_BUDGET_MS });

    return json({ job: { id: job.id, status: 'QUEUED', total: items.length } }, { status: 202 });
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
