import './setup-env.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * applyCreate against a fake Shopify and a fake database.
 *
 * The first real sync created twelve products and recorded none of them: an
 * argument-shape mistake threw a TypeError after the product already existed,
 * so every row failed *after* the write. Nothing in the suite covered how
 * these functions call each other, only what they each do alone — which is
 * exactly the gap this file closes.
 */

const state = { mappings: [], variantMappings: [] };

vi.mock('../lib/prisma.js', () => {
  const prisma = {
    productMapping: {
      upsert: vi.fn(async ({ create }) => {
        state.mappings.push(create);
        return { id: 'pm_1', ...create };
      }),
    },
    variantMapping: {
      upsert: vi.fn(async ({ create }) => {
        state.variantMappings.push(create);
        return { id: 'vm_1', ...create };
      }),
    },
    syncError: { create: vi.fn(async () => ({})) },
    collectionMapping: { upsert: vi.fn(async () => ({})) },
  };
  return { default: prisma, prisma };
});

const calls = [];

vi.mock('../services/shopify-catalog.js', async () => {
  const actual = await vi.importActual('../services/shopify-catalog.js');
  return {
    ...actual,
    createProduct: vi.fn(async () => {
      calls.push('createProduct');
      return {
        id: 'gid://shopify/Product/1',
        handle: 'disney-customizable-keychain',
        variants: {
          nodes: [{ id: 'gid://shopify/ProductVariant/1', inventoryItem: { id: 'gid://shopify/InventoryItem/1' } }],
        },
      };
    }),
    updateVariants: vi.fn(async () => {
      calls.push('updateVariants');
      return [{ id: 'gid://shopify/ProductVariant/1', inventoryItem: { id: 'gid://shopify/InventoryItem/1' } }];
    }),
    createVariants: vi.fn(async () => [{ id: 'v1', inventoryItem: { id: 'i1' } }]),
    // The real signature is (admin, options). Calling it any other way threw
    // a TypeError in production, so the fake asserts the shape.
    activateInventory: vi.fn(async (admin, options) => {
      calls.push('activateInventory');
      if (!admin || typeof admin.request !== 'function') {
        throw new TypeError('activateInventory called without an admin client');
      }
      if (!options || !options.inventoryItemId) {
        throw new TypeError('activateInventory called without inventoryItemId');
      }
      return {};
    }),
    setInventoryQuantities: vi.fn(async (admin, options) => {
      calls.push('setInventoryQuantities');
      if (!admin || typeof admin.request !== 'function') {
        throw new TypeError('setInventoryQuantities called without an admin client');
      }
      if (!options?.quantities?.length) throw new TypeError('no quantities');
      return {};
    }),
    addProductMedia: vi.fn(async () => []),
    findCollectionByTitle: vi.fn(async () => ({ id: 'gid://shopify/Collection/1', title: 'Keychains' })),
    addProductsToCollection: vi.fn(async () => ({})),
  };
});

const { applyCreate } = await import('../services/sync-engine.js');

const log = { info() {}, warn() {}, error() {}, debug() {} };

/** applyCreate with the collaborators a real job would supply. */
const applyCreateForTest = ({ admin, plan, locationId }) =>
  applyCreate({
    admin,
    plan,
    job: { id: 'job_1', shopId: 'shop_1' },
    source: { id: 'src_1' },
    locationId,
    collectionCache: new Map(),
    log,
  });

const plan = (overrides = {}) => ({
  sku: 'DIS-CUSTOM-299',
  title: 'Disney Customizable Keychain',
  handle: 'disney-customizable-keychain',
  rowNumber: 13,
  rowHash: 'hash-13',
  action: 'CREATE',
  options: [],
  images: [],
  collections: [],
  fields: {
    'product.title': 'Disney Customizable Keychain',
    'product.status': 'ACTIVE',
    'variant.sku': 'DIS-CUSTOM-299',
    'variant.price': 299,
    'variant.inventoryQuantity': 200,
  },
  ...overrides,
});

const admin = { request: vi.fn(async () => ({})) };

beforeEach(() => {
  state.mappings = [];
  state.variantMappings = [];
  calls.length = 0;
});

describe('applyCreate', () => {
  it('creates the product and records its mapping', async () => {
    const result = await applyCreateForTest({ admin, plan: plan(), locationId: 'gid://shopify/Location/1' });

    expect(result.productId).toBe('gid://shopify/Product/1');
    expect(state.mappings).toHaveLength(1);
    expect(state.mappings[0].externalKey).toBe('DIS-CUSTOM-299');
    expect(state.mappings[0].shopifyProductId).toBe('gid://shopify/Product/1');
  });

  it('activates inventory with an admin client, not a bag of options', async () => {
    // The production bug: activateInventory({ admin, ... }) instead of
    // activateInventory(admin, { ... }).
    await expect(
      applyCreateForTest({ admin, plan: plan(), locationId: 'gid://shopify/Location/1' })
    ).resolves.toBeDefined();

    expect(calls).toContain('activateInventory');
  });

  it('records the mapping before inventory, so a later failure leaves no orphan', async () => {
    const catalog = await import('../services/shopify-catalog.js');
    catalog.activateInventory.mockRejectedValueOnce(new Error('Shopify is down'));

    await expect(
      applyCreateForTest({ admin, plan: plan(), locationId: 'gid://shopify/Location/1' })
    ).rejects.toThrow('Shopify is down');

    // The product exists in Shopify, so the mapping must exist here too —
    // otherwise the next run cannot tell it was already created.
    expect(state.mappings).toHaveLength(1);
    expect(state.variantMappings).toHaveLength(1);
  });

  it('records the mapping before collections too', async () => {
    const catalog = await import('../services/shopify-catalog.js');
    catalog.addProductsToCollection.mockRejectedValueOnce(new Error('collection failed'));

    await expect(
      applyCreateForTest({
        admin,
        plan: plan({ collections: ['Keychains'] }),
        locationId: 'gid://shopify/Location/1',
      })
    ).rejects.toThrow('collection failed');

    expect(state.mappings).toHaveLength(1);
  });

  it('skips inventory when the shop has no location, rather than sending a bad request', async () => {
    await applyCreateForTest({ admin, plan: plan(), locationId: null });
    expect(calls).not.toContain('activateInventory');
    expect(state.mappings).toHaveLength(1);
  });
});
