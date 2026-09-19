import './setup-env.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The invariants under test: one job in flight per source, an enqueue that is
 * safe to repeat, and plan limits enforced before a job is created.
 */

const state = {
  source: { id: 'src_1', shopId: 'shop_1', sheets: [{ rowCount: 50 }], mappings: [] },
  runningJob: null,
  jobsByKey: new Map(),
  created: [],
  subscription: { plan: 'FREE', status: 'ACTIVE' },
  counts: { products: 0, sources: 1, rules: 0 },
};

vi.mock('../lib/prisma.js', () => {
  const prisma = {
    dataSource: {
      findFirst: vi.fn(async () => state.source),
      count: vi.fn(async () => state.counts.sources),
      update: vi.fn(async ({ data }) => ({ ...state.source, ...data })),
      updateMany: vi.fn(async () => ({ count: 0 })),
      findMany: vi.fn(async () => []),
    },
    syncJob: {
      findFirst: vi.fn(async () => state.runningJob),
      findUnique: vi.fn(async ({ where }) => state.jobsByKey.get(where.idempotencyKey) || null),
      create: vi.fn(async ({ data }) => {
        const job = { id: `job_${state.created.length + 1}`, ...data };
        state.created.push(job);
        state.jobsByKey.set(data.idempotencyKey, job);
        return job;
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    billingSubscription: {
      findUnique: vi.fn(async () => state.subscription),
      create: vi.fn(async ({ data }) => data),
    },
    productMapping: { count: vi.fn(async () => state.counts.products) },
    syncRule: { count: vi.fn(async () => state.counts.rules) },
  };
  return { default: prisma, prisma };
});

const { enqueueJob, JobConflictError, PlanLimitError } = await import('../services/job-service.js');

beforeEach(() => {
  state.runningJob = null;
  state.jobsByKey = new Map();
  state.created = [];
  state.subscription = { plan: 'FREE', status: 'ACTIVE' };
  state.source = { id: 'src_1', shopId: 'shop_1', sheets: [{ rowCount: 50 }], mappings: [] };
});

describe('enqueueJob', () => {
  it('creates a queued job', async () => {
    const job = await enqueueJob({ shopId: 'shop_1', dataSourceId: 'src_1', kind: 'PREVIEW' });
    expect(job.status).toBe('QUEUED');
    expect(job.idempotencyKey).toBeTruthy();
  });

  it('refuses to start a second job while one is running for the source', async () => {
    state.runningJob = { id: 'job_running', kind: 'SYNC' };
    await expect(
      enqueueJob({ shopId: 'shop_1', dataSourceId: 'src_1', kind: 'SYNC' })
    ).rejects.toThrow(JobConflictError);
  });

  it('names the in-flight job so the UI can link to it', async () => {
    state.runningJob = { id: 'job_running', kind: 'SYNC' };
    try {
      await enqueueJob({ shopId: 'shop_1', dataSourceId: 'src_1', kind: 'SYNC' });
      throw new Error('should have thrown');
    } catch (error) {
      expect(error.existingJobId).toBe('job_running');
      expect(error.code).toBe('job_in_progress');
    }
  });

  it('returns the existing job for a repeated idempotency key', async () => {
    const first = await enqueueJob({
      shopId: 'shop_1',
      dataSourceId: 'src_1',
      kind: 'SYNC',
      idempotencyKey: 'fixed-key',
    });
    const second = await enqueueJob({
      shopId: 'shop_1',
      dataSourceId: 'src_1',
      kind: 'SYNC',
      idempotencyKey: 'fixed-key',
    });

    expect(second.id).toBe(first.id);
    expect(state.created).toHaveLength(1);
  });

  it('blocks a sync that would exceed the plan', async () => {
    state.source.sheets = [{ rowCount: 5000 }];
    await expect(
      enqueueJob({ shopId: 'shop_1', dataSourceId: 'src_1', kind: 'SYNC' })
    ).rejects.toThrow(PlanLimitError);
  });

  it('does not apply the product limit to a preview', async () => {
    state.source.sheets = [{ rowCount: 5000 }];
    const job = await enqueueJob({ shopId: 'shop_1', dataSourceId: 'src_1', kind: 'PREVIEW' });
    expect(job.kind).toBe('PREVIEW');
  });

  it('rejects a source that does not belong to the shop', async () => {
    state.source = null;
    await expect(
      enqueueJob({ shopId: 'shop_1', dataSourceId: 'someone-elses', kind: 'SYNC' })
    ).rejects.toThrow(/does not exist/);
  });

  it('records what triggered the job', async () => {
    const job = await enqueueJob({
      shopId: 'shop_1',
      dataSourceId: 'src_1',
      kind: 'SYNC',
      triggeredBy: 'schedule',
    });
    expect(job.triggeredBy).toBe('schedule');
  });
});
