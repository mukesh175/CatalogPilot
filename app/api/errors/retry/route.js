import { withAuth, json, parseBody } from '../../../../lib/api.js';
import { retryErrorsSchema } from '../../../../validators/index.js';
import { retryErrors } from '../../../../services/error-center.js';
import { runJob } from '../../../../jobs/runner.js';

/**
 * Retries failed rows.
 *
 * Rows whose errors cannot be fixed by retrying (a duplicate SKU, a rejected
 * value) are reported back as skipped so the UI can say why instead of looping
 * the merchant through a retry that will fail identically.
 */
export const POST = withAuth(async (request, { shopId, log }) => {
  const body = await parseBody(request, retryErrorsSchema);

  const result = await retryErrors({
    shopId,
    syncJobId: body.syncJobId,
    errorIds: body.mode === 'selected' ? body.errorIds : null,
    mode: body.mode,
  });

  for (const jobId of result.jobIds) {
    runJob(jobId).catch((error) => log.error('errors.retry_run_failed', { jobId, error }));
  }

  return json(result, { status: 202 });
});
