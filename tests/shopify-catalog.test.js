import './setup-env.js';
import { describe, it, expect, vi } from 'vitest';
import {
  escapeSearchValue,
  findProductBySku,
  createProduct,
  updateVariants,
  setInventoryQuantities,
  findCollectionByTitle,
  addProductsToCollection,
} from '../services/shopify-catalog.js';
import { assertNoUserErrors, ShopifyApiError, inBatches } from '../lib/shopify/client.js';

/**
 * The catalog service is tested against a fake admin client. What matters is
 * that mutations fail loudly on userErrors, that SKU search is exact rather
 * than fuzzy, and that search values cannot break out of the query string.
 */

const fakeAdmin = (responses) => {
  const calls = [];
  return {
    calls,
    request: vi.fn(async (query, variables, options) => {
      calls.push({ operation: options?.operation, variables });
      const response = responses[options?.operation];
      if (typeof response === 'function') return response(variables);
      return response;
    }),
  };
};

describe('escapeSearchValue', () => {
  it('quotes and escapes a SKU', () => {
    expect(escapeSearchValue('AB-12')).toBe('"AB-12"');
  });

  it('escapes embedded quotes so a value cannot alter the query', () => {
    expect(escapeSearchValue('bad" OR sku:*')).toBe('"bad\\" OR sku:*"');
  });

  it('escapes backslashes', () => {
    expect(escapeSearchValue('a\\b')).toBe('"a\\\\b"');
  });
});

describe('findProductBySku', () => {
  it('returns the variant whose SKU matches exactly', async () => {
    const admin = fakeAdmin({
      FindVariantBySku: {
        productVariants: {
          nodes: [
            { id: 'v1', sku: 'SH-01-XL', product: { id: 'p1' } },
            { id: 'v2', sku: 'SH-01', product: { id: 'p2' } },
          ],
        },
      },
    });

    const result = await findProductBySku(admin, 'SH-01');
    expect(result.variant.id).toBe('v2');
    expect(result.product.id).toBe('p2');
  });

  it('matches case-insensitively', async () => {
    const admin = fakeAdmin({
      FindVariantBySku: { productVariants: { nodes: [{ id: 'v1', sku: 'sh-01', product: { id: 'p1' } }] } },
    });
    expect((await findProductBySku(admin, 'SH-01')).variant.id).toBe('v1');
  });

  it('returns null when only a partial match comes back', async () => {
    const admin = fakeAdmin({
      FindVariantBySku: {
        productVariants: { nodes: [{ id: 'v1', sku: 'SH-01-XL', product: { id: 'p1' } }] },
      },
    });
    expect(await findProductBySku(admin, 'SH-01')).toBeNull();
  });

  it('returns null when nothing is found', async () => {
    const admin = fakeAdmin({ FindVariantBySku: { productVariants: { nodes: [] } } });
    expect(await findProductBySku(admin, 'NOPE')).toBeNull();
  });
});

describe('mutations', () => {
  it('creates a product and passes its options through', async () => {
    const admin = fakeAdmin({
      CreateProduct: { productCreate: { product: { id: 'p1', handle: 'shirt' }, userErrors: [] } },
    });

    const product = await createProduct(admin, {
      product: { title: 'Shirt' },
      media: [],
      options: [{ name: 'Size', values: ['XL'] }],
    });

    expect(product.id).toBe('p1');
    expect(admin.calls[0].variables.product.productOptions).toEqual([
      { name: 'Size', values: [{ name: 'XL' }] },
    ]);
  });

  it('throws when Shopify reports a user error', async () => {
    const admin = fakeAdmin({
      CreateProduct: {
        productCreate: {
          product: null,
          userErrors: [{ field: ['handle'], message: 'Handle is already taken' }],
        },
      },
    });

    await expect(createProduct(admin, { product: { title: 'Shirt' } })).rejects.toThrow(
      /Handle is already taken/
    );
  });

  it('updates variants by id and leaves others untouched', async () => {
    const admin = fakeAdmin({
      BulkUpdateVariants: { productVariantsBulkUpdate: { productVariants: [{ id: 'v1' }], userErrors: [] } },
    });

    await updateVariants(admin, 'p1', [{ id: 'v1', price: '2700' }]);
    expect(admin.calls[0].variables.variants).toEqual([{ id: 'v1', price: '2700' }]);
  });

  it('does not call Shopify when there are no variants to update', async () => {
    const admin = fakeAdmin({});
    await updateVariants(admin, 'p1', []);
    expect(admin.request).not.toHaveBeenCalled();
  });

  it('sets inventory as an absolute quantity, never negative', async () => {
    const admin = fakeAdmin({
      SetInventory: { inventorySetQuantities: { inventoryAdjustmentGroup: {}, userErrors: [] } },
    });

    await setInventoryQuantities(admin, {
      locationId: 'loc1',
      quantities: [{ inventoryItemId: 'i1', quantity: -5 }],
    });

    const { input } = admin.calls[0].variables;
    expect(input.name).toBe('available');
    expect(input.quantities[0].quantity).toBe(0);
    expect(input.ignoreCompareQuantity).toBe(true);
  });

  it('matches a collection by exact title only', async () => {
    const admin = fakeAdmin({
      FindCollection: {
        collections: {
          nodes: [
            { id: 'c1', title: "Men's T-Shirts Sale" },
            { id: 'c2', title: "Men's T-Shirts" },
          ],
        },
      },
    });

    const found = await findCollectionByTitle(admin, "men's t-shirts");
    expect(found.id).toBe('c2');
  });

  it('skips the collection call when there are no products to add', async () => {
    const admin = fakeAdmin({});
    await addProductsToCollection(admin, 'c1', []);
    expect(admin.request).not.toHaveBeenCalled();
  });
});

describe('assertNoUserErrors', () => {
  it('passes a clean payload through', () => {
    const payload = { product: { id: 'p1' }, userErrors: [] };
    expect(assertNoUserErrors(payload, 'productCreate')).toBe(payload);
  });

  it('throws a ShopifyApiError carrying the original errors', () => {
    try {
      assertNoUserErrors({ userErrors: [{ field: ['title'], message: 'is required' }] }, 'productCreate');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ShopifyApiError);
      expect(error.userErrors).toHaveLength(1);
    }
  });

  it('handles media user errors too', () => {
    expect(() =>
      assertNoUserErrors({ mediaUserErrors: [{ message: 'Invalid image' }] }, 'productCreateMedia')
    ).toThrow(/Invalid image/);
  });
});

describe('inBatches', () => {
  it('splits work into fixed-size batches', async () => {
    const seen = [];
    await inBatches([1, 2, 3, 4, 5], 2, async (batch) => seen.push(batch));
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('does nothing for an empty list', async () => {
    const mapper = vi.fn();
    await inBatches([], 10, mapper);
    expect(mapper).not.toHaveBeenCalled();
  });
});
