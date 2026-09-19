import './setup-env.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The cron endpoint acts across every shop, so its authentication is the one
 * thing standing between a public URL and every merchant's catalog.
 */

const sweep = vi.fn(async () => ({ queued: 0, skipped: 0 }));
const drainQueue = vi.fn(async () => ({ ran: 0, yielded: 0 }));

vi.mock('../jobs/scheduler.js', () => ({ sweep: (...args) => sweep(...args) }));
vi.mock('../jobs/runner.js', () => ({ drainQueue: (...args) => drainQueue(...args) }));

process.env.CRON_SECRET = 'vercel-cron-secret-value-16+';
process.env.JOB_RUNNER_SECRET = 'manual-job-runner-secret-value';

const { GET, POST } = await import('../app/api/jobs/run/route.js');

const request = (token, method = 'GET') =>
  new Request('https://catalogpilot.test/api/jobs/run', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

beforeEach(() => {
  sweep.mockClear();
  drainQueue.mockClear();
});

describe('GET /api/jobs/run', () => {
  it('accepts the Vercel CRON_SECRET', async () => {
    const response = await GET(request(process.env.CRON_SECRET));
    expect(response.status).toBe(200);
    expect(sweep).toHaveBeenCalled();
    expect(drainQueue).toHaveBeenCalled();
  });

  it('accepts JOB_RUNNER_SECRET for a manual trigger', async () => {
    const response = await GET(request(process.env.JOB_RUNNER_SECRET));
    expect(response.status).toBe(200);
  });

  it('rejects a request with no Authorization header', async () => {
    const response = await GET(request(null));
    expect(response.status).toBe(401);
    expect(drainQueue).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const response = await GET(request('not-the-secret'));
    expect(response.status).toBe(401);
  });

  it('rejects an empty bearer token', async () => {
    const response = await GET(request(''));
    expect(response.status).toBe(401);
  });

  it('does not accept a Shopify session token', async () => {
    const response = await GET(request('eyJhbGciOiJIUzI1NiJ9.eyJkZXN0IjoieCJ9.sig'));
    expect(response.status).toBe(401);
  });

  it('passes a deadline to the queue drain so it yields before the kill', async () => {
    await GET(request(process.env.CRON_SECRET));
    const { deadline } = drainQueue.mock.calls[0][0];
    expect(deadline).toBeGreaterThan(Date.now());
    // 300s limit minus the 20s safety margin.
    expect(deadline).toBeLessThanOrEqual(Date.now() + 280_000);
  });

  it('reports what it did', async () => {
    sweep.mockResolvedValueOnce({ queued: 2, skipped: 1 });
    drainQueue.mockResolvedValueOnce({ ran: 3, yielded: 1 });

    const response = await GET(request(process.env.CRON_SECRET));
    const body = await response.json();

    expect(body).toMatchObject({ scheduled: 2, skipped: 1, jobsRun: 3, jobsYielded: 1 });
  });
});

describe('POST /api/jobs/run', () => {
  it('works the same way for a manual trigger', async () => {
    const response = await POST(request(process.env.JOB_RUNNER_SECRET, 'POST'));
    expect(response.status).toBe(200);
  });

  it('is still protected', async () => {
    const response = await POST(request('nope', 'POST'));
    expect(response.status).toBe(401);
  });
});
