import { assertNoUserErrors, ShopifyApiError } from '../lib/shopify/client.js';
import {
  FIND_VARIANT_BY_SKU,
  GET_PRODUCT,
  LIST_PRODUCTS,
  CREATE_PRODUCT,
  UPDATE_PRODUCT,
  CREATE_PRODUCT_MEDIA,
  BULK_CREATE_VARIANTS,
  BULK_UPDATE_VARIANTS,
  SET_INVENTORY,
  ACTIVATE_INVENTORY,
  FIND_COLLECTION,
  CREATE_COLLECTION,
  ADD_PRODUCTS_TO_COLLECTION,
  LIST_COLLECTIONS,
  GET_SHOP,
  GET_PRODUCT_COUNT,
} from '../graphql/products.js';

/**
 * Shopify catalog operations.
 *
 * Deliberately does NOT use `productSet`: that mutation deletes any variant not
 * present in the input, which would silently destroy variants whenever a
 * supplier sheet is incomplete. Creates and updates are split so an update can
 * only ever touch the fields that were actually mapped.
 */

/** Escapes a value for use inside a Shopify search query string. */
export function escapeSearchValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function getShopContext(admin) {
  const data = await admin.request(GET_SHOP, {}, { operation: 'GetShop' });
  return {
    shop: data.shop,
    primaryLocationId: data.locations?.nodes?.[0]?.id || null,
  };
}

export async function getProductCount(admin) {
  const data = await admin.request(GET_PRODUCT_COUNT, {}, { operation: 'ProductCount' });
  return data.productsCount?.count ?? 0;
}

export async function listProducts(admin, { first = 25, after = null, query = null } = {}) {
  const data = await admin.request(
    LIST_PRODUCTS,
    { first, after, query },
    { operation: 'ListProducts' }
  );
  return data.products;
}

export async function getProduct(admin, id) {
  const data = await admin.request(GET_PRODUCT, { id }, { operation: 'GetProduct' });
  return data.product;
}

/** Finds an existing product by variant SKU. Returns null when absent. */
export async function findProductBySku(admin, sku) {
  const data = await admin.request(
    FIND_VARIANT_BY_SKU,
    { query: `sku:${escapeSearchValue(sku)}` },
    { operation: 'FindVariantBySku' }
  );
  // Shopify's search is tokenized, so an exact comparison is still required.
  const match = (data.productVariants?.nodes || []).find(
    (node) => String(node.sku || '').toLowerCase() === String(sku).toLowerCase()
  );
  if (!match) return null;
  return { variant: match, product: match.product };
}

/**
 * Creates a product with its first variant.
 * `options` shapes the option names so variants can be added afterwards.
 */
export async function createProduct(admin, { product, media, options }) {
  const input = { ...product };
  if (options?.length) {
    input.productOptions = options.map((opt) => ({
      name: opt.name,
      values: opt.values.map((value) => ({ name: value })),
    }));
  }

  const data = await admin.request(
    CREATE_PRODUCT,
    { product: input, media: media?.length ? media : undefined },
    { operation: 'CreateProduct' }
  );
  assertNoUserErrors(data.productCreate, 'productCreate');
  return data.productCreate.product;
}

export async function updateProduct(admin, product) {
  const data = await admin.request(UPDATE_PRODUCT, { product }, { operation: 'UpdateProduct' });
  assertNoUserErrors(data.productUpdate, 'productUpdate');
  return data.productUpdate.product;
}

/**
 * Appends media to a product.
 * Image failures are reported per item rather than failing the whole row —
 * a dead image URL should not block a price update.
 */
export async function addProductMedia(admin, productId, media) {
  if (!media?.length) return [];
  const data = await admin.request(
    CREATE_PRODUCT_MEDIA,
    { productId, media },
    { operation: 'CreateProductMedia' }
  );
  const errors = data.productCreateMedia?.mediaUserErrors || [];
  if (errors.length) {
    throw new ShopifyApiError(errors.map((e) => e.message).join('; '), {
      code: errors[0]?.code || 'media_error',
      userErrors: errors,
    });
  }
  return data.productCreateMedia.media;
}

export async function createVariants(admin, productId, variants) {
  const data = await admin.request(
    BULK_CREATE_VARIANTS,
    { productId, variants, strategy: 'REMOVE_STANDALONE_VARIANT' },
    { operation: 'BulkCreateVariants' }
  );
  assertNoUserErrors(data.productVariantsBulkCreate, 'productVariantsBulkCreate');
  return data.productVariantsBulkCreate.productVariants;
}

/**
 * Updates existing variants in place.
 * Only variants explicitly listed are touched; omitted variants are left alone.
 */
export async function updateVariants(admin, productId, variants) {
  if (!variants.length) return [];
  const data = await admin.request(
    BULK_UPDATE_VARIANTS,
    { productId, variants },
    { operation: 'BulkUpdateVariants' }
  );
  assertNoUserErrors(data.productVariantsBulkUpdate, 'productVariantsBulkUpdate');
  return data.productVariantsBulkUpdate.productVariants;
}

/**
 * Sets absolute available quantities at a location.
 * `ignoreCompareQuantity` is true because supplier data is authoritative here
 * and a concurrent store edit should not abort the whole batch.
 */
export async function setInventoryQuantities(admin, { locationId, quantities, reason = 'correction' }) {
  if (!quantities.length) return null;
  const data = await admin.request(
    SET_INVENTORY,
    {
      input: {
        name: 'available',
        reason,
        ignoreCompareQuantity: true,
        quantities: quantities.map((q) => ({
          inventoryItemId: q.inventoryItemId,
          locationId,
          quantity: Math.max(0, Math.round(q.quantity)),
        })),
      },
    },
    { operation: 'SetInventory' }
  );
  assertNoUserErrors(data.inventorySetQuantities, 'inventorySetQuantities');
  return data.inventorySetQuantities.inventoryAdjustmentGroup;
}

/** Stocks an inventory item at a location before quantities can be set. */
export async function activateInventory(admin, { inventoryItemId, locationId, available = 0 }) {
  const data = await admin.request(
    ACTIVATE_INVENTORY,
    { inventoryItemId, locationId, available },
    { operation: 'ActivateInventory' }
  );
  assertNoUserErrors(data.inventoryActivate, 'inventoryActivate');
  return data.inventoryActivate.inventoryLevel;
}

export async function listCollections(admin, { first = 50, after = null } = {}) {
  const data = await admin.request(LIST_COLLECTIONS, { first, after }, { operation: 'ListCollections' });
  return data.collections;
}

/** Finds a collection by exact title. */
export async function findCollectionByTitle(admin, title) {
  const data = await admin.request(
    FIND_COLLECTION,
    { query: `title:${escapeSearchValue(title)}` },
    { operation: 'FindCollection' }
  );
  const nodes = data.collections?.nodes || [];
  return (
    nodes.find((c) => c.title.toLowerCase() === String(title).toLowerCase()) || null
  );
}

export async function createCollection(admin, title) {
  const data = await admin.request(
    CREATE_COLLECTION,
    { input: { title } },
    { operation: 'CreateCollection' }
  );
  assertNoUserErrors(data.collectionCreate, 'collectionCreate');
  return data.collectionCreate.collection;
}

export async function addProductsToCollection(admin, collectionId, productIds) {
  if (!productIds.length) return null;
  const data = await admin.request(
    ADD_PRODUCTS_TO_COLLECTION,
    { id: collectionId, productIds },
    { operation: 'AddProductsToCollection' }
  );
  assertNoUserErrors(data.collectionAddProducts, 'collectionAddProducts');
  return data.collectionAddProducts.collection;
}
