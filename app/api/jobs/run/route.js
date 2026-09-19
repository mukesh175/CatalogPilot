import { NextResponse } from 'next/server';
import { safeEqual } from '../../../../lib/crypto.js';
import { logger } from '../../../../lib/logger.js';
import { withErrorHandling, json } from '../../../../lib/api.js';
import { drainQueue } from '../../../../jobs/runner.js';
import { sweep } from '../../../../jobs/scheduler.js';

/**
 * The job runner, invoked by Vercel Cron.
 *
 * Vercel sends a GET with `Authorization: Bearer <CRON_SECRET>`, so GET is the
 * primary method. POST is kept for triggering the runner yourself with
 * JOB_RUNNER_SECRET (a local run, an external scheduler, or a non-Vercel host).
 *
 * This endpoint acts across every shop, so it is never reachable with a
 * merchant session token — only with a server-side secret.
 */

// Hobby and Pro both allow 300s; Pro can raise this to 800. Work is stopped
// before the limit by the deadline below, so the function returns cleanly
// instead of being killed with a job still locked.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Stop this much before the hard limit, leaving room to release locks and
// write the response.
const SAFETY_MARGIN_MS = 20_000;

function isAuthorized(request) {
  const header = request.headers.get('authorization') || '';
  const provided = header.replace(/^Bearer\s+/i, '');
  if (!provided) return false;

  const { CRON_SECRET, JOB_RUNNER_SECRET } = process.env;
  // Compared against both so the same endpoint serves Vercel Cron and a manual
  // trigger without a second route.
  return (
    (Boolean(CRON_SECRET) && safeEqual(provided, CRON_SECRET)) ||
    (Boolean(JOB_RUNNER_SECRET) && safeEqual(provided, JOB_RUNNER_SECRET))
  );
}

async function handle(request) {
  if (!isAuthorized(request)) {
    logger.warn('jobs.run_unauthorized', { userAgent: request.headers.get('user-agent') });
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const startedAt = Date.now();
  const deadline = startedAt + maxDuration * 1000 - SAFETY_MARGIN_MS;

  const url = new URL(request.url);
  const max = Math.min(Number(url.searchParams.get('max')) || 5, 25);

  // Queue anything whose schedule is due, then work the queue until the
  // deadline. A job that does not finish hands itself back and the next tick
  // continues it.
  const scheduled = await sweep();
  const drained = await drainQueue({ max, deadline });

  const result = {
    scheduled: scheduled.queued,
    skipped: scheduled.skipped,
    jobsRun: drained.ran,
    jobsYielded: drained.yielded,
    durationMs: Date.now() - startedAt,
  };

  logger.info('jobs.run_complete', result);
  return json(result);
}

export const GET = withErrorHandling(handle);
export const POST = withErrorHandling(handle);
