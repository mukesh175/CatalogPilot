import { describe, it, expect } from 'vitest';
import {
  toNumber,
  matchesConditions,
  evaluateExpression,
  applyPriceRules,
  applyInventoryRules,
  applyTagRules,
  applyCollectionRules,
  RuleError,
} from '../services/rules-engine.js';

const priceRule = (overrides = {}) => ({
  kind: 'PRICE',
  name: 'Standard markup',
  isEnabled: true,
  priority: 100,
  conditions: { operator: 'AND', clauses: [] },
  priceRule: {
    targetField: 'variant.price',
    expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.4 } },
    ...overrides,
  },
});

describe('toNumber', () => {
  it('parses messy supplier values', () => {
    expect(toNumber('₹2,500.00')).toBe(2500);
    expect(toNumber('  1299 ')).toBe(1299);
    expect(toNumber('$19.99')).toBe(19.99);
    expect(toNumber(42)).toBe(42);
  });

  it('returns null for unusable values', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('N/A')).toBeNull();
  });
});

describe('matchesConditions', () => {
  const row = { 'product.productType': 'Electronics', 'variant.inventoryQuantity': '3' };

  it('treats an empty clause list as always matching', () => {
    expect(matchesConditions({ clauses: [] }, row).matched).toBe(true);
  });

  it('evaluates AND across clauses', () => {
    const conditions = {
      operator: 'AND',
      clauses: [
        { field: 'product.productType', op: 'equals', value: 'electronics' },
        { field: 'variant.inventoryQuantity', op: 'lt', value: 5 },
      ],
    };
    expect(matchesConditions(conditions, row).matched).toBe(true);
  });

  it('evaluates OR across clauses', () => {
    const conditions = {
      operator: 'OR',
      clauses: [
        { field: 'product.productType', op: 'equals', value: 'Clothing' },
        { field: 'variant.inventoryQuantity', op: 'lt', value: 5 },
      ],
    };
    expect(matchesConditions(conditions, row).matched).toBe(true);
  });

  it('fails a numeric comparison against non-numeric data rather than coercing', () => {
    const conditions = {
      operator: 'AND',
      clauses: [{ field: 'product.productType', op: 'gt', value: 5 }],
    };
    expect(matchesConditions(conditions, row).matched).toBe(false);
  });

  it('rejects an unknown operator', () => {
    expect(() =>
      matchesConditions({ clauses: [{ field: 'a', op: 'explode', value: 1 }] }, row)
    ).toThrow(RuleError);
  });
});

describe('evaluateExpression', () => {
  const row = { 'variant.cost': '2000' };

  it('computes cost x 1.35', () => {
    const result = evaluateExpression({ op: '*', left: { field: 'variant.cost' }, right: { value: 1.35 } }, row);
    expect(result.value).toBe(2700);
    expect(result.text).toBe('(cost * 1.35)');
  });

  it('computes cost + fixed amount', () => {
    const result = evaluateExpression({ op: '+', left: { field: 'variant.cost' }, right: { value: 200 } }, row);
    expect(result.value).toBe(2200);
  });

  it('treats % as adding a percentage', () => {
    const result = evaluateExpression({ op: '%', left: { field: 'variant.cost' }, right: { value: 18 } }, row);
    expect(result.value).toBe(2360);
  });

  it('supports nested formulas like cost x 1.30 + 100', () => {
    const result = evaluateExpression(
      {
        op: '+',
        left: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.3 } },
        right: { value: 100 },
      },
      row
    );
    expect(result.value).toBe(2700);
  });

  it('refuses to divide by zero', () => {
    expect(() =>
      evaluateExpression({ op: '/', left: { field: 'variant.cost' }, right: { value: 0 } }, row)
    ).toThrow(/divides by zero/);
  });

  it('reports a missing source column clearly', () => {
    expect(() => evaluateExpression({ field: 'variant.cost' }, {})).toThrow(/No usable number/);
  });
});

describe('applyPriceRules', () => {
  const row = { 'variant.cost': 2000, 'product.productType': 'Electronics' };

  it('applies the markup and explains it', () => {
    const result = applyPriceRules([priceRule()], row);
    expect(result.value).toBe(2800);
    expect(result.explanation.rule).toBe('Standard markup');
    expect(result.explanation.steps[0]).toContain('cost * 1.4');
  });

  it('rounds to a price ending in 99', () => {
    const result = applyPriceRules(
      [priceRule({ roundingMode: 'ENDING', endingValue: 99 })],
      { 'variant.cost': 1000 }
    );
    // 1000 x 1.4 = 1400 -> nearest value ending in 99 at or above is 1499
    expect(result.value).toBe(1499);
  });

  it('enforces a minimum price', () => {
    const result = applyPriceRules([priceRule({ minPrice: 499 })], { 'variant.cost': 100 });
    expect(result.value).toBe(499);
    expect(result.explanation.steps.join(' ')).toMatch(/minimum/);
  });

  it('enforces a maximum price', () => {
    const result = applyPriceRules([priceRule({ maxPrice: 9999 })], { 'variant.cost': 20000 });
    expect(result.value).toBe(9999);
  });

  it('picks the first rule whose conditions match, by priority', () => {
    const electronics = {
      ...priceRule({ expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.25 } } }),
      name: 'Electronics',
      priority: 10,
      conditions: {
        operator: 'AND',
        clauses: [{ field: 'product.productType', op: 'equals', value: 'Electronics' }],
      },
    };
    const clothing = {
      ...priceRule({ expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.5 } } }),
      name: 'Clothing',
      priority: 20,
      conditions: {
        operator: 'AND',
        clauses: [{ field: 'product.productType', op: 'equals', value: 'Clothing' }],
      },
    };

    expect(applyPriceRules([clothing, electronics], row).value).toBe(2500);
    expect(applyPriceRules([clothing, electronics], { ...row, 'product.productType': 'Clothing' }).value).toBe(
      3000
    );
  });

  it('returns null when no rule matches so the price is left alone', () => {
    const rule = {
      ...priceRule(),
      conditions: { operator: 'AND', clauses: [{ field: 'product.productType', op: 'equals', value: 'Toys' }] },
    };
    expect(applyPriceRules([rule], row)).toBeNull();
  });

  it('skips disabled rules', () => {
    expect(applyPriceRules([{ ...priceRule(), isEnabled: false }], row)).toBeNull();
  });
});

describe('applyInventoryRules', () => {
  const rule = (config) => ({
    kind: 'INVENTORY',
    name: 'Stock policy',
    isEnabled: true,
    priority: 100,
    conditions: { operator: 'AND', clauses: [] },
    inventoryRule: { safetyStock: 0, zeroOutBelowMin: false, ...config },
  });

  it('subtracts safety stock', () => {
    const result = applyInventoryRules([rule({ safetyStock: 3 })], {}, { supplierQuantity: 20 });
    expect(result.quantity).toBe(17);
    expect(result.explanation.steps.join(' ')).toMatch(/safety stock/);
  });

  it('never goes negative', () => {
    const result = applyInventoryRules([rule({ safetyStock: 10 })], {}, { supplierQuantity: 2 });
    expect(result.quantity).toBe(0);
  });

  it('zeroes out below the minimum threshold', () => {
    const result = applyInventoryRules(
      [rule({ minThreshold: 5, zeroOutBelowMin: true })],
      {},
      { supplierQuantity: 3 }
    );
    expect(result.quantity).toBe(0);
  });

  it('drafts the product when stock hits zero', () => {
    const result = applyInventoryRules(
      [rule({ setStatusWhenZero: 'DRAFT' })],
      {},
      { supplierQuantity: 0 }
    );
    expect(result.status).toBe('DRAFT');
  });

  it('activates the product when stock returns', () => {
    const result = applyInventoryRules(
      [rule({ setStatusWhenInStock: 'ACTIVE' })],
      {},
      { supplierQuantity: 12 }
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('passes the quantity through when there are no rules', () => {
    const result = applyInventoryRules([], {}, { supplierQuantity: '25' });
    expect(result.quantity).toBe(25);
    expect(result.status).toBeNull();
  });

  it('returns null when the supplier sent no usable quantity', () => {
    expect(applyInventoryRules([], {}, { supplierQuantity: '' })).toBeNull();
  });
});

describe('applyTagRules', () => {
  const rule = (config) => ({
    kind: 'TAG',
    name: 'Auto tags',
    isEnabled: true,
    priority: 100,
    conditions: { operator: 'AND', clauses: [] },
    tagRule: { sourceFields: [], staticTags: [], lowercase: true, replaceExisting: false, ...config },
  });

  it('builds tags from brand and category', () => {
    const result = applyTagRules(
      [rule({ sourceFields: ['product.vendor', 'product.productType'] })],
      { 'product.vendor': 'Nike', 'product.productType': 'Shoes' }
    );
    expect(result.tags).toEqual(['nike', 'shoes']);
  });

  it('merges with existing tags by default', () => {
    const result = applyTagRules([rule({ staticTags: ['imported'] })], {}, { existingTags: ['sale'] });
    expect(result.tags).toEqual(['imported', 'sale']);
  });

  it('replaces existing tags only when asked', () => {
    const result = applyTagRules(
      [rule({ staticTags: ['imported'], replaceExisting: true })],
      {},
      { existingTags: ['sale'] }
    );
    expect(result.tags).toEqual(['imported']);
  });

  it('splits multi-value cells', () => {
    const result = applyTagRules([rule({ sourceFields: ['product.tags'] })], {
      'product.tags': 'summer, cotton; new',
    });
    expect(result.tags).toEqual(['cotton', 'new', 'summer']);
  });

  it('returns null when no tag rule exists', () => {
    expect(applyTagRules([], {})).toBeNull();
  });
});

describe('applyCollectionRules', () => {
  const rule = (config) => ({
    kind: 'COLLECTION',
    name: 'Category to collection',
    isEnabled: true,
    priority: 100,
    conditions: { operator: 'AND', clauses: [] },
    collectionRule: { sourceField: 'product.productType', valueMap: [], createIfMissing: false, ...config },
  });

  it('maps a supplier category to a store collection', () => {
    const result = applyCollectionRules(
      [
        rule({
          valueMap: [
            { from: 'T-Shirts', to: "Men's T-Shirts" },
            { from: 'Jeans', to: "Men's Jeans" },
          ],
        }),
      ],
      { 'product.productType': 'T-Shirts' }
    );
    expect(result.titles).toEqual(["Men's T-Shirts"]);
  });

  it('passes an unmapped category through unchanged', () => {
    const result = applyCollectionRules([rule()], { 'product.productType': 'Hats' });
    expect(result.titles).toEqual(['Hats']);
  });

  it('supports multiple collections per product', () => {
    const result = applyCollectionRules([rule()], { 'product.productType': 'Shirts, Formal' });
    expect(result.titles).toEqual(['Shirts', 'Formal']);
  });

  it('uses the fallback when the category cell is empty', () => {
    const result = applyCollectionRules([rule({ fallbackCollection: 'Uncategorized' })], {
      'product.productType': '',
    });
    expect(result.titles).toEqual(['Uncategorized']);
  });

  it('returns null when no collection rule exists', () => {
    expect(applyCollectionRules([], {})).toBeNull();
  });
});
