import { waitUntil } from '@vercel/functions';
import { logger } from './logger.js';

/**
 * Keeps work alive after the response is sent.
 *
 * On a serverless host the function is frozen the moment the response goes
 * out, so a bare `promise.catch(...)` after `return` is simply lost — a sync
 * kicked off that way would never start. `waitUntil` registers the work with
 * the platform so it keeps running. Outside Vercel it falls back to leaving
 * the promise attached, which is what a long-lived Node process needs anyway.
 */
export function runInBackground(promise, context = {}) {
  const guarded = Promise.resolve(promise).catch((error) => {
    logger.error('background.task_failed', { ...context, error });
  });

  try {
    waitUntil(guarded);
  } catch {
    // waitUntil throws outside a Vercel request context (local dev, the
    // standalone worker). The promise is already running; nothing else to do.
  }

  return guarded;
}

/**
 * Kicks a job without blocking the response.
 *
 * The cron runner is the safety net: if this invocation is cut short, the job
 * is still QUEUED and the next tick picks it up. That is why nothing here
 * needs to await the result.
 */
export function kickJob(jobId, runner, { deadline = null } = {}) {
  return runInBackground(runner(jobId, { deadline }), { jobId });
}
