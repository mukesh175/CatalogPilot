import { describe, it, expect } from 'vitest';
import {
  transformRow,
  validateRow,
  imageUrls,
  optionPairs,
  toHandle,
  isBlank,
} from '../services/row-transformer.js';

const headers = ['Title', 'SKU', 'Price', 'Stock', 'Status', 'Image', 'Weight', 'Tags'];

const mappings = [
  { sourceColumn: 'Title', columnIndex: 0, targetField: 'product.title' },
  { sourceColumn: 'SKU', columnIndex: 1, targetField: 'variant.sku' },
  { sourceColumn: 'Price', columnIndex: 2, targetField: 'variant.price' },
  { sourceColumn: 'Stock', columnIndex: 3, targetField: 'variant.inventoryQuantity' },
  { sourceColumn: 'Status', columnIndex: 4, targetField: 'product.status' },
  { sourceColumn: 'Image', columnIndex: 5, targetField: 'media.image1' },
  { sourceColumn: 'Weight', columnIndex: 6, targetField: 'variant.weight' },
  { sourceColumn: 'Tags', columnIndex: 7, targetField: 'product.tags' },
];

const run = (cells) => transformRow({ cells, mappings, headers });

describe('transformRow', () => {
  it('coerces each column to its declared type', () => {
    const { fields } = run([
      'Blue Shirt',
      'SH-01',
      '₹1,299.50',
      '12',
      'active',
      'https://cdn.example.com/a.jpg',
      '1.5',
      'summer, cotton',
    ]);

    expect(fields['product.title']).toBe('Blue Shirt');
    expect(fields['variant.price']).toBe(1299.5);
    expect(fields['variant.inventoryQuantity']).toBe(12);
    expect(fields['product.status']).toBe('ACTIVE');
    expect(fields['variant.weight']).toBe(1.5);
    expect(fields['product.tags']).toEqual(['summer', 'cotton']);
  });

  it('omits blank cells entirely so they cannot clear a field', () => {
    const { fields } = run(['Blue Shirt', 'SH-01', '', '', '', '', '', '']);
    expect('variant.price' in fields).toBe(false);
    expect('product.status' in fields).toBe(false);
  });

  it('warns instead of throwing on an unparseable number', () => {
    const { fields, warnings } = run(['Blue Shirt', 'SH-01', 'call us', '5', '', '', '', '']);
    expect('variant.price' in fields).toBe(false);
    expect(warnings[0].field).toBe('variant.price');
    expect(warnings[0].message).toMatch(/not a valid amount/);
  });

  it('rejects a negative price with a warning', () => {
    const { warnings } = run(['Blue Shirt', 'SH-01', '-20', '', '', '', '', '']);
    expect(warnings[0].message).toMatch(/negative/);
  });

  it('warns about a non-URL image value', () => {
    const { warnings } = run(['Blue Shirt', 'SH-01', '10', '', '', 'photo.jpg', '', '']);
    expect(warnings[0].field).toBe('media.image1');
  });

  it('understands the many ways suppliers write status', () => {
    expect(run(['T', 'S', '', '', 'Published', '', '', '']).fields['product.status']).toBe('ACTIVE');
    expect(run(['T', 'S', '', '', 'no', '', '', '']).fields['product.status']).toBe('DRAFT');
    expect(run(['T', 'S', '', '', 'discontinued', '', '', '']).fields['product.status']).toBe('ARCHIVED');
  });

  it('warns about an unrecognised status rather than guessing', () => {
    const { warnings, fields } = run(['T', 'S', '', '', 'maybe later', '', '', '']);
    expect('product.status' in fields).toBe(false);
    expect(warnings[0].message).toMatch(/not a recognised product status/);
  });

  it('skips columns the merchant ignored', () => {
    const { fields } = transformRow({
      cells: ['Blue Shirt', 'SH-01', '10', '', '', '', '', ''],
      mappings: mappings.map((m) => (m.targetField === 'variant.price' ? { ...m, isIgnored: true } : m)),
      headers,
    });
    expect('variant.price' in fields).toBe(false);
  });
});

describe('validateRow', () => {
  it('requires a SKU', () => {
    const errors = validateRow({ 'product.title': 'Shirt' });
    expect(errors.some((e) => e.field === 'variant.sku')).toBe(true);
  });

  it('requires a title', () => {
    const errors = validateRow({ 'variant.sku': 'SH-01' });
    expect(errors.some((e) => e.field === 'product.title')).toBe(true);
  });

  it('accepts a complete row', () => {
    expect(validateRow({ 'variant.sku': 'SH-01', 'product.title': 'Shirt' })).toEqual([]);
  });

  it('flags a compare-at price below the selling price', () => {
    const errors = validateRow({
      'variant.sku': 'SH-01',
      'product.title': 'Shirt',
      'variant.price': 200,
      'variant.compareAtPrice': 100,
    });
    expect(errors.some((e) => e.field === 'variant.compareAtPrice')).toBe(true);
  });

  it('rejects an absurd price', () => {
    const errors = validateRow({
      'variant.sku': 'SH-01',
      'product.title': 'Shirt',
      'variant.price': 100_000_000,
    });
    expect(errors.some((e) => e.field === 'variant.price')).toBe(true);
  });

  it('gives every error an actionable suggestion', () => {
    const errors = validateRow({});
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect(error.suggestion).toBeTruthy();
  });
});

describe('helpers', () => {
  it('collects images in order', () => {
    expect(
      imageUrls({ 'media.image1': 'a.jpg', 'media.image3': 'c.jpg' })
    ).toEqual(['a.jpg', 'c.jpg']);
  });

  it('builds option pairs and skips incomplete ones', () => {
    const pairs = optionPairs({
      'variant.option1Name': 'Colour',
      'variant.option1Value': 'Blue',
      'variant.option2Value': 'L',
      'variant.option3Name': 'Material',
    });
    expect(pairs).toEqual([
      { name: 'Colour', value: 'Blue' },
      { name: 'Option 2', value: 'L' },
    ]);
  });

  it('guesses a size option name from its value', () => {
    expect(optionPairs({ 'variant.option1Value': 'XL' })).toEqual([{ name: 'Size', value: 'XL' }]);
  });

  it('builds a Shopify handle from a title', () => {
    expect(toHandle('Nike Air Max 90 — Blue!')).toBe('nike-air-max-90-blue');
    expect(toHandle('Café Crème')).toBe('cafe-creme');
  });

  it('detects blank values', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank(null)).toBe(true);
    expect(isBlank(0)).toBe(false);
  });
});
