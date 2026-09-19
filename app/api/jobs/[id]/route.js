import { withAuth, json, apiError } from '../../../../lib/api.js';
import { jobProgress, requestCancel } from '../../../../services/job-service.js';

/** Live progress for the sync progress bar. Polled while a job is running. */
export const GET = withAuth(async (request, { shopId, params }) => {
  const progress = await jobProgress({ shopId, jobId: params.id });
  if (!progress) return apiError('That sync could not be found.', { status: 404, code: 'not_found' });
  return json({ job: progress });
});

/** Requests cancellation of a running job. */
export const DELETE = withAuth(async (request, { shopId, params }) => {
  const job = await requestCancel({ shopId, jobId: params.id });
  if (!job) {
    return apiError('That sync has already finished.', { status: 409, code: 'not_running' });
  }
  return json({ cancelRequested: true });
});
