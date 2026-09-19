import { describe, it, expect } from 'vitest';
import {
  normalizeHeader,
  scoreHeader,
  suggestMappings,
  validateMappingSet,
} from '../services/mapping-engine.js';

describe('normalizeHeader', () => {
  it('strips punctuation, casing and separators', () => {
    expect(normalizeHeader('Product_Name')).toBe('product name');
    expect(normalizeHeader('  COMPARE-AT PRICE ')).toBe('compare at price');
    expect(normalizeHeader('SKU #')).toBe('sku');
  });

  it('handles accented characters', () => {
    expect(normalizeHeader('Catégorie')).toBe('categorie');
  });

  it('returns an empty string for blank headers', () => {
    expect(normalizeHeader(null)).toBe('');
    expect(normalizeHeader('   ')).toBe('');
  });
});

describe('scoreHeader', () => {
  it('matches known supplier column names exactly', () => {
    const [best] = scoreHeader('Product Name');
    expect(best.field).toBe('product.title');
    expect(best.score).toBe(1);
  });

  it('matches a decorated header through containment', () => {
    const [best] = scoreHeader('Selling Price (INR)');
    expect(best.field).toBe('variant.price');
    expect(best.score).toBeGreaterThan(0.6);
  });

  it('returns nothing for a header with no plausible target', () => {
    expect(scoreHeader('zzz internal ref 4471')).toHaveLength(0);
  });
});

describe('suggestMappings', () => {
  const headers = [
    'Product Name',
    'Description',
    'SKU',
    'Cost Price',
    'Selling Price',
    'Stock',
    'Brand',
    'Category',
    'Image URL',
    'Internal Notes',
  ];

  it('maps a typical supplier sheet', () => {
    const result = suggestMappings(headers);
    const byColumn = Object.fromEntries(result.map((m) => [m.sourceColumn, m.targetField]));

    expect(byColumn['Product Name']).toBe('product.title');
    expect(byColumn['SKU']).toBe('variant.sku');
    expect(byColumn['Cost Price']).toBe('variant.cost');
    expect(byColumn['Selling Price']).toBe('variant.price');
    expect(byColumn['Stock']).toBe('variant.inventoryQuantity');
    expect(byColumn['Image URL']).toBe('media.image1');
  });

  it('never assigns one Shopify field to two columns', () => {
    const result = suggestMappings(['Price', 'Selling Price', 'Retail Price']);
    const targets = result.filter((m) => m.targetField).map((m) => m.targetField);
    expect(new Set(targets).size).toBe(targets.length);
  });

  it('surfaces unmatched columns instead of dropping them', () => {
    const result = suggestMappings(headers);
    const notes = result.find((m) => m.sourceColumn === 'Internal Notes');
    expect(notes).toBeDefined();
    expect(notes.targetField).toBeNull();
    expect(notes.requiresReview).toBe(true);
  });

  it('returns one row per source column', () => {
    expect(suggestMappings(headers)).toHaveLength(headers.length);
  });

  it('flags a low-confidence high-risk field for review', () => {
    const result = suggestMappings(['Prc.']);
    const row = result[0];
    if (row.targetField === 'variant.price') {
      expect(row.confidence).toBe('NEEDS_REVIEW');
    }
  });

  it('keeps merchant-confirmed mappings untouched', () => {
    const existing = [
      {
        sourceColumn: 'Internal Notes',
        normalized: 'internal notes',
        targetField: 'product.descriptionHtml',
        confidence: 'HIGH',
        score: 1,
        isConfirmed: true,
        isIgnored: false,
      },
    ];
    const result = suggestMappings(headers, { existing });
    const notes = result.find((m) => m.sourceColumn === 'Internal Notes');
    expect(notes.targetField).toBe('product.descriptionHtml');
    expect(notes.isConfirmed).toBe(true);

    // The confirmed field is consumed, so Description must land elsewhere.
    const description = result.find((m) => m.sourceColumn === 'Description');
    expect(description.targetField).not.toBe('product.descriptionHtml');
  });
});

describe('validateMappingSet', () => {
  it('requires title and sku', () => {
    const result = validateMappingSet([
      { sourceColumn: 'Product Name', targetField: 'product.title', isConfirmed: true, confidence: 'EXACT' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.missing.map((m) => m.field)).toContain('variant.sku');
  });

  it('blocks a sync while a mapping still needs review', () => {
    const result = validateMappingSet([
      { sourceColumn: 'A', targetField: 'product.title', isConfirmed: true, confidence: 'EXACT' },
      { sourceColumn: 'B', targetField: 'variant.sku', isConfirmed: false, confidence: 'NEEDS_REVIEW' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.needsReview).toHaveLength(1);
  });

  it('passes when required fields are mapped and confirmed', () => {
    const result = validateMappingSet([
      { sourceColumn: 'A', targetField: 'product.title', isConfirmed: true, confidence: 'EXACT' },
      { sourceColumn: 'B', targetField: 'variant.sku', isConfirmed: true, confidence: 'EXACT' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('ignores columns the merchant switched off', () => {
    const result = validateMappingSet([
      { sourceColumn: 'A', targetField: 'product.title', isConfirmed: true, confidence: 'EXACT' },
      { sourceColumn: 'B', targetField: 'variant.sku', isConfirmed: true, confidence: 'EXACT' },
      { sourceColumn: 'C', targetField: 'product.status', isConfirmed: false, confidence: 'LOW', isIgnored: true },
    ]);
    expect(result.ok).toBe(true);
  });
});
