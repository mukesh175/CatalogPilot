import prisma from '../../../lib/prisma.js';
import { withAuth, json } from '../../../lib/api.js';
import { attentionItems } from '../../../services/notifications.js';
import { planLimits, planUsage } from '../../../services/billing.js';

/**
 * Everything the dashboard renders, in one round trip.
 * All metrics are real counts from this shop's data — nothing here is a
 * placeholder or a sample figure.
 */
export const GET = withAuth(async (request, { shopId, shopRecord }) => {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    sources,
    productsManaged,
    variantsManaged,
    collectionsManaged,
    recentHistory,
    activeJob,
    openErrors,
    attention,
    limits,
    usage,
    last30,
  ] = await Promise.all([
    prisma.dataSource.count({ where: { shopId, status: { not: 'DISCONNECTED' } } }),
    prisma.productMapping.count({ where: { shopId } }),
    prisma.variantMapping.count({ where: { shopId } }),
    prisma.collectionMapping.count({ where: { shopId } }),
    prisma.syncHistory.findMany({
      where: { shopId },
      orderBy: { startedAt: 'desc' },
      take: 5,
      include: { dataSource: { select: { id: true, name: true } } },
    }),
    prisma.syncJob.findFirst({
      where: { shopId, status: { in: ['QUEUED', 'RUNNING'] } },
      orderBy: { createdAt: 'desc' },
      include: { dataSource: { select: { id: true, name: true } } },
    }),
    prisma.syncError.count({ where: { syncJob: { shopId }, resolvedAt: null, ignoredAt: null } }),
    attentionItems(shopId),
    planLimits(shopId),
    planUsage(shopId),
    prisma.syncHistory.findMany({
      where: { shopId, startedAt: { gte: since } },
      orderBy: { startedAt: 'asc' },
      select: { startedAt: true, created: true, updated: true, failed: true, scanned: true },
    }),
  ]);

  // Sync health is the share of rows in the last 30 days that did not fail.
  const totals = last30.reduce(
    (acc, row) => ({
      scanned: acc.scanned + row.scanned,
      failed: acc.failed + row.failed,
      created: acc.created + row.created,
      updated: acc.updated + row.updated,
    }),
    { scanned: 0, failed: 0, created: 0, updated: 0 }
  );
  const health = totals.scanned > 0 ? Math.round(((totals.scanned - totals.failed) / totals.scanned) * 100) : null;

  return json({
    shop: {
      domain: shopRecord.domain,
      name: shopRecord.name,
      currencyCode: shopRecord.currencyCode,
      onboardingDone: shopRecord.onboardingDone,
    },
    metrics: {
      sources,
      productsManaged,
      variantsManaged,
      collectionsManaged,
      openErrors,
      health,
      last30Days: totals,
    },
    plan: { ...limits, usage },
    activeJob: activeJob
      ? {
          id: activeJob.id,
          kind: activeJob.kind,
          status: activeJob.status,
          processed: activeJob.processedRows,
          total: activeJob.totalRows,
          source: activeJob.dataSource,
        }
      : null,
    attention,
    recentActivity: recentHistory.map((row) => ({
      id: row.id,
      jobId: row.syncJobId,
      source: row.dataSource,
      startedAt: row.startedAt,
      durationMs: row.durationMs,
      scanned: row.scanned,
      created: row.created,
      updated: row.updated,
      failed: row.failed,
      status: row.status,
    })),
    trend: buildTrend(last30),
  });
});

/** Daily counts for the dashboard sparkline, zero-filled so gaps are visible. */
function buildTrend(rows) {
  const byDay = new Map();
  for (const row of rows) {
    const key = row.startedAt.toISOString().slice(0, 10);
    const current = byDay.get(key) || { date: key, created: 0, updated: 0, failed: 0 };
    current.created += row.created;
    current.updated += row.updated;
    current.failed += row.failed;
    byDay.set(key, current);
  }

  const out = [];
  for (let i = 29; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out.push(byDay.get(date) || { date, created: 0, updated: 0, failed: 0 });
  }
  return out;
}
