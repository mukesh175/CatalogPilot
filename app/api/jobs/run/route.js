import { NextResponse } from 'next/server';
import { env } from '../../../../lib/env.js';
import { safeEqual } from '../../../../lib/crypto.js';
import { logger } from '../../../../lib/logger.js';
import { withErrorHandling, json, apiError } from '../../../../lib/api.js';
import { drainQueue } from '../../../../jobs/runner.js';
import { sweep } from '../../../../jobs/scheduler.js';

/**
 * Job trigger for deployments without a long-running worker.
 *
 * Protected by a shared secret rather than a merchant session: this endpoint
 * acts across shops, so it must never be reachable with a session token.
 * Point a platform cron at it every minute.
 */
export const POST = withErrorHandling(async (request) => {
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!safeEqual(provided, env().JOB_RUNNER_SECRET)) {
    logger.warn('jobs.run_unauthorized', {});
    return new NextResponse(null, { status: 401 });
  }

  const url = new URL(request.url);
  const max = Math.min(Number(url.searchParams.get('max')) || 5, 25);

  const scheduled = await sweep();
  const ran = await drainQueue({ max });

  return json({ scheduled, ran });
});

export const GET = withErrorHandling(async () =>
  apiError('Use POST with the job runner secret.', { status: 405, code: 'method_not_allowed' })
);
