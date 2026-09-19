import prisma from '../../../lib/prisma.js';
import { withAuth, json } from '../../../lib/api.js';
import { searchQuerySchema } from '../../../validators/index.js';

/**
 * Global search (the "/" shortcut).
 *
 * Searches the app's own records — products it manages, SKUs, collections,
 * sources, errors and syncs — so results come back in one query round trip
 * rather than fanning out to Shopify on every keystroke.
 */
export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const { q } = searchQuerySchema.parse(Object.fromEntries(url.searchParams.entries()));
  const contains = { contains: q, mode: 'insensitive' };

  const [products, variants, collections, sources, errors] = await Promise.all([
    prisma.productMapping.findMany({
      where: { shopId, OR: [{ externalKey: contains }, { handle: contains }] },
      take: 5,
      select: { id: true, externalKey: true, handle: true, shopifyProductId: true },
    }),
    prisma.variantMapping.findMany({
      where: { shopId, sku: contains },
      take: 5,
      select: { id: true, sku: true, shopifyVariantId: true, productMapping: { select: { handle: true } } },
    }),
    prisma.collectionMapping.findMany({
      where: { shopId, OR: [{ title: contains }, { sourceValue: contains }] },
      take: 5,
      select: { id: true, title: true, shopifyCollectionId: true },
    }),
    prisma.dataSource.findMany({
      where: { shopId, name: contains },
      take: 5,
      select: { id: true, name: true, status: true },
    }),
    prisma.syncError.findMany({
      where: {
        syncJob: { shopId },
        resolvedAt: null,
        ignoredAt: null,
        OR: [{ sku: contains }, { productTitle: contains }, { message: contains }],
      },
      take: 5,
      select: { id: true, message: true, sku: true, syncJobId: true },
    }),
  ]);

  const results = [
    ...products.map((p) => ({
      type: 'product',
      id: p.id,
      title: p.handle || p.externalKey,
      subtitle: `SKU ${p.externalKey}`,
      href: `/catalog/products?q=${encodeURIComponent(p.externalKey)}`,
    })),
    ...variants.map((v) => ({
      type: 'variant',
      id: v.id,
      title: v.sku,
      subtitle: v.productMapping?.handle || 'Variant',
      href: `/catalog/variants?q=${encodeURIComponent(v.sku)}`,
    })),
    ...collections.map((c) => ({
      type: 'collection',
      id: c.id,
      title: c.title,
      subtitle: 'Collection',
      href: '/catalog/collections',
    })),
    ...sources.map((s) => ({
      type: 'source',
      id: s.id,
      title: s.name,
      subtitle: `Source · ${s.status.toLowerCase()}`,
      href: `/sources/${s.id}`,
    })),
    ...errors.map((e) => ({
      type: 'error',
      id: e.id,
      title: e.message,
      subtitle: e.sku ? `SKU ${e.sku}` : 'Error',
      href: `/sync/errors?jobId=${e.syncJobId}`,
    })),
  ];

  return json({ query: q, results });
});
