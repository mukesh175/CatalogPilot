import prisma from '../../../../lib/prisma.js';
import { withAuth, json } from '../../../../lib/api.js';
import { listCollections } from '../../../../services/shopify-catalog.js';

export const GET = withAuth(async (request, { shopId, admin }) => {
  const url = new URL(request.url);
  const after = url.searchParams.get('after') || null;

  const page = await listCollections(admin, { first: 50, after });
  const mappings = await prisma.collectionMapping.findMany({
    where: { shopId },
    select: { shopifyCollectionId: true, sourceValue: true, createdByApp: true },
  });
  const byId = new Map(mappings.map((m) => [m.shopifyCollectionId, m]));

  return json({
    collections: page.nodes.map((collection) => ({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      productCount: collection.productsCount?.count ?? 0,
      mappedFrom: byId.get(collection.id)?.sourceValue || null,
      createdByApp: byId.get(collection.id)?.createdByApp || false,
    })),
    pageInfo: page.pageInfo,
  });
});
