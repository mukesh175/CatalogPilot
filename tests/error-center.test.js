import './setup-env.js';
import { describe, it, expect } from 'vitest';
import { describeError } from '../services/error-center.js';
import { ShopifyApiError, ShopifyAuthError } from '../lib/shopify/client.js';
import { GoogleAuthError } from '../lib/google/oauth.js';
import { RuleError } from '../services/rules-engine.js';

/**
 * The contract here is that a merchant never reads a raw API message as the
 * primary text, and that every failure says what to do next.
 */

describe('describeError', () => {
  it('turns a 404 image failure into plain guidance', () => {
    const result = describeError(
      new ShopifyApiError('Image download failed: 404 Not Found', { code: 'media_error' })
    );
    expect(result.kind).toBe('IMAGE');
    expect(result.message).toBe('The image could not be downloaded.');
    expect(result.suggestion).toMatch(/open the image url/i);
    expect(result.isRetryable).toBe(true);
  });

  it('marks a duplicate SKU as needing a data fix, not a retry', () => {
    const result = describeError(
      new ShopifyApiError('Sku has already been taken', { code: 'user_error' })
    );
    expect(result.kind).toBe('VALIDATION');
    expect(result.isRetryable).toBe(false);
    expect(result.message).toMatch(/already used/i);
  });

  it('explains a taken handle', () => {
    const result = describeError(new ShopifyApiError('Handle is already taken'));
    expect(result.message).toMatch(/URL handle/i);
    expect(result.isRetryable).toBe(false);
  });

  it('treats an unstocked inventory item as retryable', () => {
    const result = describeError(new ShopifyApiError('The inventory item is not stocked at the location'));
    expect(result.isRetryable).toBe(true);
    expect(result.message).toMatch(/not stocked/i);
  });

  it('explains a variant limit as unfixable by retrying', () => {
    const result = describeError(new ShopifyApiError('Variant limit exceeded: maximum 2048 variants'));
    expect(result.isRetryable).toBe(false);
  });

  it('maps throttling to a retryable rate-limit error', () => {
    const result = describeError(new ShopifyApiError('cost limit', { code: 'throttled' }));
    expect(result.kind).toBe('RATE_LIMIT');
    expect(result.isRetryable).toBe(true);
  });

  it('tells the merchant to reconnect when Shopify rejects the token', () => {
    const result = describeError(new ShopifyAuthError());
    expect(result.kind).toBe('PERMISSION');
    expect(result.message).toMatch(/no longer has permission/i);
    expect(result.isRetryable).toBe(false);
  });

  it('routes a revoked Google grant to the reconnect flow', () => {
    const result = describeError(
      new GoogleAuthError('Access to your Google account was revoked', {
        code: 'google_revoked',
        needsReconnect: true,
      })
    );
    expect(result.kind).toBe('GOOGLE_API');
    expect(result.suggestion).toMatch(/reconnect/i);
    expect(result.isRetryable).toBe(false);
  });

  it('explains a broken rule and names the field', () => {
    const result = describeError(new RuleError('No usable number in the "variant.cost" column', { field: 'variant.cost' }));
    expect(result.kind).toBe('VALIDATION');
    expect(result.field).toBe('variant.cost');
    expect(result.isRetryable).toBe(false);
  });

  it('never leaks a stack trace for an unknown error', () => {
    const result = describeError(new Error('TypeError: cannot read property x of undefined at line 42'));
    expect(result.kind).toBe('UNKNOWN');
    expect(result.message).toBe('Something went wrong while syncing this row.');
    expect(result.message).not.toMatch(/TypeError/);
    expect(result.suggestion).toBeTruthy();
  });

  it('surfaces a Shopify user error with its field, readably', () => {
    const result = describeError(
      new ShopifyApiError('Price must be positive', {
        userErrors: [{ field: ['input', 'price'], message: 'Price must be positive' }],
      })
    );
    expect(result.message).toBe('Price: Price must be positive');
    expect(result.isRetryable).toBe(true);
  });
});
