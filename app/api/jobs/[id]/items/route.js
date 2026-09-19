import prisma from '../../../../../lib/prisma.js';
import { withAuth, json, apiError } from '../../../../../lib/api.js';
import { previewQuerySchema } from '../../../../../validators/index.js';

/**
 * Paged preview rows.
 *
 * The preview of a large catalog can be tens of thousands of rows, so the
 * browser only ever receives one page — filtering and counting happen in
 * Postgres.
 */
export const GET = withAuth(async (request, { shopId, params }) => {
  const url = new URL(request.url);
  const query = previewQuerySchema.parse({
    ...Object.fromEntries(url.searchParams.entries()),
    jobId: params.id,
  });

  const job = await prisma.syncJob.findFirst({
    where: { id: params.id, shopId },
    select: { id: true, status: true, kind: true },
  });
  if (!job) return apiError('That sync could not be found.', { status: 404, code: 'not_found' });

  const where = {
    syncJobId: job.id,
    ...(query.action !== 'ALL' ? { action: query.action } : {}),
    ...(query.search
      ? {
          OR: [
            { sku: { contains: query.search, mode: 'insensitive' } },
            { title: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, items, counts] = await Promise.all([
    prisma.syncJobItem.count({ where }),
    prisma.syncJobItem.findMany({
      where,
      orderBy: { rowNumber: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.syncJobItem.groupBy({
      by: ['action'],
      where: { syncJobId: job.id },
      _count: { _all: true },
    }),
  ]);

  const summary = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0, SKIP: 0 };
  for (const row of counts) summary[row.action] = row._count._all;

  return json({
    job: { id: job.id, status: job.status, kind: job.kind },
    summary,
    pagination: { page: query.page, pageSize: query.pageSize, total },
    items: items.map((item) => ({
      id: item.id,
      rowNumber: item.rowNumber,
      sku: item.sku,
      title: item.title,
      action: item.action,
      status: item.status,
      changes: item.changes,
      warnings: item.warnings,
      shopifyProductId: item.shopifyProductId,
    })),
  });
});
