import { describe, it, expect } from 'vitest';
import { planRow, valuesEqual, summarize, currentValues } from '../services/sync-planner.js';

const headers = ['Product Name', 'SKU', 'Cost Price', 'Stock', 'Brand', 'Category', 'Image URL'];

const mappings = [
  { sourceColumn: 'Product Name', columnIndex: 0, targetField: 'product.title', isIgnored: false },
  { sourceColumn: 'SKU', columnIndex: 1, targetField: 'variant.sku', isIgnored: false },
  { sourceColumn: 'Cost Price', columnIndex: 2, targetField: 'variant.cost', isIgnored: false },
  { sourceColumn: 'Stock', columnIndex: 3, targetField: 'variant.inventoryQuantity', isIgnored: false },
  { sourceColumn: 'Brand', columnIndex: 4, targetField: 'product.vendor', isIgnored: false },
  { sourceColumn: 'Category', columnIndex: 5, targetField: 'product.productType', isIgnored: false },
  { sourceColumn: 'Image URL', columnIndex: 6, targetField: 'media.image1', isIgnored: false },
];

const row = (cells, rowNumber = 2) => ({ rowNumber, cells, hash: `hash-${rowNumber}` });

const markupRule = {
  kind: 'PRICE',
  name: 'Cost x 1.35',
  isEnabled: true,
  priority: 100,
  conditions: { operator: 'AND', clauses: [] },
  priceRule: {
    targetField: 'variant.price',
    expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.35 } },
  },
};

const existingProduct = ({ price = '2500.00', title = 'Nike Air Max', tags = [] } = {}) => ({
  product: {
    id: 'gid://shopify/Product/1',
    handle: 'nike-air-max',
    title,
    vendor: 'Nike',
    productType: 'Shoes',
    status: 'ACTIVE',
    tags,
    descriptionHtml: null,
    seo: {},
    media: { nodes: [] },
    collections: { nodes: [] },
  },
  variant: {
    id: 'gid://shopify/ProductVariant/1',
    sku: 'NK-001',
    price,
    compareAtPrice: null,
    inventoryQuantity: 20,
    inventoryItem: { id: 'gid://shopify/InventoryItem/1', unitCost: { amount: '2000.00' } },
  },
});

describe('planRow — new products', () => {
  it('plans a create for a product with no Shopify match', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', 'https://cdn.example.com/a.jpg']),
      headers,
      mappings,
      rules: [markupRule],
      existing: null,
    });

    expect(result.action).toBe('CREATE');
    expect(result.sku).toBe('NK-001');
    expect(result.fields['variant.price']).toBe(2700);
    expect(result.images).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('explains the calculated price', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [markupRule],
      existing: null,
    });

    const priceChange = result.changes.find((c) => c.field === 'variant.price');
    expect(priceChange.explanation.rule).toBe('Cost x 1.35');
    expect(priceChange.explanation.result).toContain('2,700.00');
  });
});

describe('planRow — updates', () => {
  it('detects a price change and shows both values', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [markupRule],
      existing: existingProduct(),
    });

    expect(result.action).toBe('UPDATE');
    const priceChange = result.changes.find((c) => c.field === 'variant.price');
    expect(priceChange.current).toBe(2500);
    expect(priceChange.incoming).toBe(2700);
  });

  it('reports UNCHANGED when every mapped value already matches', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: existingProduct({ price: '2000.00' }),
    });

    expect(result.action).toBe('UNCHANGED');
    expect(result.changes).toHaveLength(0);
  });

  it('carries the Shopify ids needed to apply the change', () => {
    const result = planRow({
      row: row(['Nike Air Max Plus', 'NK-001', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: existingProduct(),
    });

    expect(result.shopifyProductId).toBe('gid://shopify/Product/1');
    expect(result.shopifyVariantId).toBe('gid://shopify/ProductVariant/1');
    expect(result.inventoryItemId).toBe('gid://shopify/InventoryItem/1');
  });
});

describe('planRow — safety', () => {
  it('does not clear a Shopify field when the source cell is blank', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', '', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: existingProduct({ price: '2000.00' }),
      settings: { allowBlankOverwrite: false },
    });

    expect(result.changes.find((c) => c.field === 'product.vendor')).toBeUndefined();
    expect(result.action).toBe('UNCHANGED');
  });

  it('clears the field only when the merchant enabled blank overwrite', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', '', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: existingProduct({ price: '2000.00' }),
      settings: { allowBlankOverwrite: true },
    });

    const vendorChange = result.changes.find((c) => c.field === 'product.vendor');
    expect(vendorChange.action).toBe('clear');
    expect(vendorChange.incoming).toBeNull();
  });

  it('leaves product status alone when status changes are disabled', () => {
    const statusRule = {
      kind: 'INVENTORY',
      name: 'Draft when out of stock',
      isEnabled: true,
      priority: 100,
      conditions: { operator: 'AND', clauses: [] },
      inventoryRule: { safetyStock: 0, setStatusWhenZero: 'DRAFT' },
    };
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '0', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [statusRule],
      existing: existingProduct({ price: '2000.00' }),
      settings: { allowStatusChange: false },
    });

    expect(result.changes.find((c) => c.field === 'product.status')).toBeUndefined();
  });

  it('skips images entirely when image updates are disabled', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', 'https://cdn.example.com/a.jpg']),
      headers,
      mappings,
      rules: [],
      existing: existingProduct({ price: '2000.00' }),
      settings: { allowImageUpdate: false },
    });

    expect(result.changes.find((c) => c.field === 'media')).toBeUndefined();
  });
});

describe('planRow — errors and warnings', () => {
  it('flags a row with no SKU instead of creating a product', () => {
    const result = planRow({
      row: row(['Nike Air Max', '', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: null,
    });

    expect(result.action).toBe('ERROR');
    expect(result.errors[0].field).toBe('variant.sku');
    expect(result.errors[0].suggestion).toBeTruthy();
  });

  it('flags a row with no title', () => {
    const result = planRow({
      row: row(['', 'NK-001', '2000', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [],
      existing: null,
    });
    expect(result.action).toBe('ERROR');
    expect(result.errors[0].field).toBe('product.title');
  });

  it('warns about an unusable image URL without failing the row', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', '2000', '20', 'Nike', 'Shoes', 'not-a-url']),
      headers,
      mappings,
      rules: [],
      existing: null,
    });

    expect(result.action).toBe('CREATE');
    expect(result.warnings[0].field).toBe('media.image1');
  });

  it('turns a broken price rule into a row error, not a crash', () => {
    const result = planRow({
      row: row(['Nike Air Max', 'NK-001', 'N/A', '20', 'Nike', 'Shoes', '']),
      headers,
      mappings,
      rules: [markupRule],
      existing: null,
    });

    expect(result.action).toBe('ERROR');
    expect(result.errors[0].message).toMatch(/rule could not be applied/i);
  });
});

describe('valuesEqual', () => {
  it('treats Shopify money strings and sheet numbers as equal', () => {
    expect(valuesEqual('2500.00', 2500)).toBe(true);
    expect(valuesEqual('2500.00', 2500.004)).toBe(true);
    expect(valuesEqual('2500.00', 2501)).toBe(false);
  });

  it('compares tag lists regardless of order or case', () => {
    expect(valuesEqual(['Nike', 'Shoes'], ['shoes', 'nike'])).toBe(true);
    expect(valuesEqual(['Nike'], ['nike', 'shoes'])).toBe(false);
  });

  it('trims whitespace on strings', () => {
    expect(valuesEqual(' Nike ', 'Nike')).toBe(true);
  });
});

describe('currentValues', () => {
  it('flattens a Shopify product and variant into planner fields', () => {
    const values = currentValues(existingProduct());
    expect(values['variant.price']).toBe(2500);
    expect(values['variant.cost']).toBe(2000);
    expect(values['product.status']).toBe('ACTIVE');
  });
});

describe('summarize', () => {
  it('counts each outcome', () => {
    const summary = summarize([
      { action: 'CREATE', warnings: [] },
      { action: 'UPDATE', warnings: [{}] },
      { action: 'UNCHANGED', warnings: [] },
      { action: 'ERROR', warnings: [] },
    ]);
    expect(summary).toMatchObject({ total: 4, create: 1, update: 1, unchanged: 1, error: 1, warnings: 1 });
  });
});
