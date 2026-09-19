import prisma from '../../../../lib/prisma.js';
import { withAuth, json } from '../../../../lib/api.js';
import { paginationSchema } from '../../../../validators/index.js';

/**
 * Variants CatalogPilot manages, from the local mapping records.
 * This is the "what does the app control" view, so it reads from our own
 * tables rather than paging the whole store on every load.
 */
export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const { page, pageSize } = paginationSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const search = url.searchParams.get('q');

  const where = {
    shopId,
    ...(search ? { sku: { contains: search, mode: 'insensitive' } } : {}),
  };

  const [total, variants] = await Promise.all([
    prisma.variantMapping.count({ where }),
    prisma.variantMapping.findMany({
      where,
      orderBy: { lastSyncedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        productMapping: {
          select: { externalKey: true, handle: true, shopifyProductId: true, dataSource: { select: { name: true } } },
        },
      },
    }),
  ]);

  return json({
    pagination: { page, pageSize, total },
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      shopifyVariantId: variant.shopifyVariantId,
      shopifyProductId: variant.productMapping.shopifyProductId,
      handle: variant.productMapping.handle,
      sourceName: variant.productMapping.dataSource?.name || null,
      lastSyncedAt: variant.lastSyncedAt,
    })),
  });
});
