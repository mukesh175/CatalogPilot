import './setup-env.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Serverless resume behaviour.
 *
 * A Vercel function is killed at its duration limit, so the runner has to stop
 * on its own, hand the job back as QUEUED, and let the next cron tick continue.
 * These tests pin that contract, because getting it wrong either strands a job
 * under a lock or re-applies work that already reached Shopify.
 */

const state = { job: null, updates: [], itemCount: 0 };

vi.mock('../lib/prisma.js', () => {
  const prisma = {
    syncJob: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      findUnique: vi.fn(async () => state.job),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }) => {
        state.updates.push(data);
        return { ...state.job, ...data };
      }),
    },
    syncJobItem: { count: vi.fn(async () => state.itemCount) },
    syncError: { create: vi.fn(async () => ({})) },
    syncHistory: { upsert: vi.fn(async () => ({})) },
    dataSource: { update: vi.fn(async () => ({})) },
  };
  return { default: prisma, prisma };
});

const buildPlan = vi.fn();
const applyPlan = vi.fn();
const completeJob = vi.fn(async () => ({ status: 'COMPLETED', totalRows: 10, unchangedCount: 0 }));

vi.mock('../services/sync-engine.js', () => ({
  claimJob: vi.fn(async () => state.job),
  releaseStaleJobs: vi.fn(async () => 0),
  buildPlan: (...args) => buildPlan(...args),
  applyPlan: (...args) => applyPlan(...args),
  completeJob: (...args) => completeJob(...args),
}));

vi.mock('../services/notifications.js', () => ({ notify: vi.fn(async () => true) }));

const { runJob } = await import('../jobs/runner.js');

const job = (overrides = {}) => ({
  id: 'job_1',
  shopId: 'shop_1',
  kind: 'SYNC',
  planCompletedAt: new Date(),
  shop: { domain: 'test-store.myshopify.com' },
  dataSource: { id: 'src_1', name: 'Supplier sheet' },
  ...overrides,
});

beforeEach(() => {
  state.updates = [];
  state.itemCount = 0;
  buildPlan.mockReset();
  applyPlan.mockReset();
  completeJob.mockClear();
});

describe('runJob — completion', () => {
  it('completes a sync that finished within its budget', async () => {
    state.job = job();
    applyPlan.mockResolvedValue({ created: 3, updated: 2, skipped: 0, failed: 0, incomplete: false });

    const result = await runJob('job_1');

    expect(result.status).toBe('COMPLETED');
    expect(completeJob).toHaveBeenCalled();
  });

  it('skips planning when the plan is already complete', async () => {
    state.job = job({ planCompletedAt: new Date() });
    applyPlan.mockResolvedValue({ created: 0, updated: 0, skipped: 0, failed: 0, incomplete: false });

    await runJob('job_1');
    expect(buildPlan).not.toHaveBeenCalled();
  });

  it('plans first when the plan was never finished', async () => {
    state.job = job({ planCompletedAt: null });
    buildPlan.mockResolvedValue({ total: 10, incomplete: false });
    applyPlan.mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, incomplete: false });

    await runJob('job_1');
    expect(buildPlan).toHaveBeenCalled();
    expect(applyPlan).toHaveBeenCalled();
  });
});

describe('runJob — yielding on a deadline', () => {
  it('hands the job back as QUEUED when the plan runs out of time', async () => {
    state.job = job({ planCompletedAt: null });
    buildPlan.mockResolvedValue({ total: 500, incomplete: true });

    const result = await runJob('job_1', { deadline: Date.now() + 1000 });

    expect(result.incomplete).toBe(true);
    expect(result.status).toBe('QUEUED');
    expect(result.phase).toBe('plan');
    // Crucially, it must not have gone on to apply a half-built plan.
    expect(applyPlan).not.toHaveBeenCalled();
    expect(completeJob).not.toHaveBeenCalled();
  });

  it('hands the job back as QUEUED when applying runs out of time', async () => {
    state.job = job();
    applyPlan.mockResolvedValue({ created: 20, updated: 5, skipped: 0, failed: 0, incomplete: true });

    const result = await runJob('job_1', { deadline: Date.now() + 1000 });

    expect(result.incomplete).toBe(true);
    expect(result.phase).toBe('apply');
    expect(completeJob).not.toHaveBeenCalled();
  });

  it('releases the lock when it yields, so the next tick can claim it', async () => {
    state.job = job();
    applyPlan.mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, incomplete: true });

    await runJob('job_1', { deadline: Date.now() + 1000 });

    const release = state.updates.find((update) => update.status === 'QUEUED');
    expect(release).toBeDefined();
    expect(release.lockedAt).toBeNull();
    expect(release.lockedBy).toBeNull();
  });

  it('yields a preview the same way', async () => {
    state.job = job({ kind: 'PREVIEW', planCompletedAt: null });
    buildPlan.mockResolvedValue({ total: 100, incomplete: true });

    const result = await runJob('job_1', { deadline: Date.now() + 1000 });

    expect(result.incomplete).toBe(true);
    expect(result.phase).toBe('preview');
    expect(completeJob).not.toHaveBeenCalled();
  });

  it('passes the deadline down to both phases', async () => {
    state.job = job({ planCompletedAt: null });
    buildPlan.mockResolvedValue({ total: 10, incomplete: false });
    applyPlan.mockResolvedValue({ created: 1, updated: 0, skipped: 0, failed: 0, incomplete: false });

    const deadline = Date.now() + 5000;
    await runJob('job_1', { deadline });

    expect(buildPlan.mock.calls[0][1].deadline).toBe(deadline);
    expect(applyPlan.mock.calls[0][1].deadline).toBe(deadline);
  });
});

describe('runJob — failure', () => {
  it('marks the job failed and records a merchant-facing error', async () => {
    state.job = job();
    applyPlan.mockRejectedValue(new Error('something broke'));

    const result = await runJob('job_1');

    expect(result.status).toBe('FAILED');
    expect(state.updates.some((update) => update.status === 'FAILED')).toBe(true);
  });

  it('returns unclaimed when another worker already holds the job', async () => {
    const { claimJob } = await import('../services/sync-engine.js');
    claimJob.mockResolvedValueOnce(null);

    const result = await runJob('job_1');
    expect(result.claimed).toBe(false);
  });
});
