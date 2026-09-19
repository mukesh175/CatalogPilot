import './setup-env.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Entitlement decisions run against a stubbed database so the plan rules can be
 * checked exhaustively without a Postgres instance. What matters here is that
 * the limits are enforced server-side and that a denial names the upgrade.
 */

const state = {
  subscription: { plan: 'FREE', status: 'ACTIVE' },
  counts: { products: 0, sources: 0, rules: 0 },
};

vi.mock('../lib/prisma.js', () => {
  const prisma = {
    billingSubscription: {
      findUnique: vi.fn(async () => state.subscription),
      create: vi.fn(async ({ data }) => data),
      upsert: vi.fn(async ({ update }) => ({ ...state.subscription, ...update })),
    },
    productMapping: { count: vi.fn(async () => state.counts.products) },
    dataSource: {
      count: vi.fn(async () => state.counts.sources),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    syncRule: { count: vi.fn(async () => state.counts.rules) },
    shop: { findUnique: vi.fn(async () => ({ id: 'shop_1' })) },
  };
  return { default: prisma, prisma };
});

const { checkEntitlement, planLimits } = await import('../services/billing.js');

beforeEach(() => {
  state.subscription = { plan: 'FREE', status: 'ACTIVE' };
  state.counts = { products: 0, sources: 0, rules: 0 };
});

describe('planLimits', () => {
  it('returns Free limits for a free shop', async () => {
    const limits = await planLimits('shop_1');
    expect(limits.tier).toBe('FREE');
    expect(limits.maxProducts).toBe(100);
    expect(limits.schedules).toEqual(['MANUAL']);
  });

  it('returns Pro limits with unlimited products', async () => {
    state.subscription = { plan: 'PRO', status: 'ACTIVE' };
    const limits = await planLimits('shop_1');
    expect(limits.maxProducts).toBeNull();
    expect(limits.schedules).toContain('HOURLY');
  });

  it('falls back to Free when a paid subscription is not active', async () => {
    state.subscription = { plan: 'GROWTH', status: 'CANCELLED' };
    const limits = await planLimits('shop_1');
    expect(limits.tier).toBe('FREE');
  });
});

describe('checkEntitlement — sources', () => {
  it('allows the first source on Free', async () => {
    expect((await checkEntitlement('shop_1', 'add_source')).allowed).toBe(true);
  });

  it('blocks a second source on Free and names the upgrade', async () => {
    state.counts.sources = 1;
    const result = await checkEntitlement('shop_1', 'add_source');
    expect(result.allowed).toBe(false);
    expect(result.upgradeTo).toBe('STARTER');
    expect(result.reason).toMatch(/1 data source/);
  });

  it('allows five sources on Growth', async () => {
    state.subscription = { plan: 'GROWTH', status: 'ACTIVE' };
    state.counts.sources = 4;
    expect((await checkEntitlement('shop_1', 'add_source')).allowed).toBe(true);
    state.counts.sources = 5;
    expect((await checkEntitlement('shop_1', 'add_source')).allowed).toBe(false);
  });
});

describe('checkEntitlement — schedules', () => {
  it('blocks scheduled sync on Free', async () => {
    const result = await checkEntitlement('shop_1', 'schedule', { schedule: 'DAILY' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not available on the Free plan/i);
  });

  it('always allows manual', async () => {
    expect((await checkEntitlement('shop_1', 'schedule', { schedule: 'MANUAL' })).allowed).toBe(true);
  });

  it('allows daily on Starter but not hourly', async () => {
    state.subscription = { plan: 'STARTER', status: 'ACTIVE' };
    expect((await checkEntitlement('shop_1', 'schedule', { schedule: 'DAILY' })).allowed).toBe(true);
    expect((await checkEntitlement('shop_1', 'schedule', { schedule: 'HOURLY' })).allowed).toBe(false);
  });

  it('allows hourly on Pro', async () => {
    state.subscription = { plan: 'PRO', status: 'ACTIVE' };
    expect((await checkEntitlement('shop_1', 'schedule', { schedule: 'HOURLY' })).allowed).toBe(true);
  });
});

describe('checkEntitlement — products and rules', () => {
  it('blocks a sync larger than the plan allows', async () => {
    const result = await checkEntitlement('shop_1', 'sync_products', { count: 500 });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/100 products/);
  });

  it('allows a sync within the plan', async () => {
    expect((await checkEntitlement('shop_1', 'sync_products', { count: 80 })).allowed).toBe(true);
  });

  it('allows any catalog size on Pro', async () => {
    state.subscription = { plan: 'PRO', status: 'ACTIVE' };
    expect((await checkEntitlement('shop_1', 'sync_products', { count: 500_000 })).allowed).toBe(true);
  });

  it('caps rules on Free', async () => {
    state.counts.rules = 3;
    const result = await checkEntitlement('shop_1', 'add_rule');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/3 rules/);
  });

  it('allows unknown actions rather than failing closed on a typo', async () => {
    expect((await checkEntitlement('shop_1', 'something_else')).allowed).toBe(true);
  });
});
