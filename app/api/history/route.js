import prisma from '../../../lib/prisma.js';
import { withAuth, json } from '../../../lib/api.js';
import { paginationSchema } from '../../../validators/index.js';

export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const { page, pageSize } = paginationSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const dataSourceId = url.searchParams.get('sourceId') || undefined;

  const where = { shopId, ...(dataSourceId ? { dataSourceId } : {}) };

  const [total, history] = await Promise.all([
    prisma.syncHistory.count({ where }),
    prisma.syncHistory.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { dataSource: { select: { id: true, name: true } } },
    }),
  ]);

  return json({
    pagination: { page, pageSize, total },
    history: history.map((row) => ({
      id: row.id,
      jobId: row.syncJobId,
      source: row.dataSource,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      durationMs: row.durationMs,
      scanned: row.scanned,
      created: row.created,
      updated: row.updated,
      unchanged: row.unchanged,
      skipped: row.skipped,
      failed: row.failed,
      status: row.status,
      triggeredBy: row.triggeredBy,
    })),
  });
});
