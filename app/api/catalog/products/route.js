import prisma from '../../../../lib/prisma.js';
import { withAuth, json } from '../../../../lib/api.js';
import { listProducts } from '../../../../services/shopify-catalog.js';

/**
 * Products as Shopify sees them, annotated with what CatalogPilot manages.
 * Paged through Shopify's cursor so a 50,000 product catalog stays responsive.
 */
export const GET = withAuth(async (request, { shopId, admin }) => {
  const url = new URL(request.url);
  const after = url.searchParams.get('after') || null;
  const search = url.searchParams.get('q');

  const page = await listProducts(admin, {
    first: 25,
    after,
    query: search ? `title:*${search}* OR sku:*${search}*` : null,
  });

  const productIds = page.nodes.map((p) => p.id);
  const managed = await prisma.productMapping.findMany({
    where: { shopId, shopifyProductId: { in: productIds } },
    select: { shopifyProductId: true, externalKey: true, lastSyncedAt: true },
  });
  const managedById = new Map(managed.map((m) => [m.shopifyProductId, m]));

  return json({
    products: page.nodes.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      vendor: product.vendor,
      productType: product.productType,
      inventory: product.totalInventory,
      image: product.featuredMedia?.image?.url || null,
      sku: product.variants?.nodes?.[0]?.sku || null,
      price: product.variants?.nodes?.[0]?.price || null,
      managed: managedById.has(product.id),
      lastSyncedAt: managedById.get(product.id)?.lastSyncedAt || null,
    })),
    pageInfo: page.pageInfo,
  });
});
