import './setup-env.js';
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhook, WebhookError } from '../lib/shopify/webhooks.js';

/**
 * Webhook verification protects a route that mutates shop state without a
 * session, so forgery, tampering, replay and stale delivery are all covered.
 */

const SHOP = 'test-store.myshopify.com';

function sign(body) {
  return crypto.createHmac('sha256', process.env.SHOPIFY_API_SECRET).update(body, 'utf8').digest('base64');
}

function webhookRequest({
  body = JSON.stringify({ id: 1 }),
  hmac,
  topic = 'app/uninstalled',
  shop = SHOP,
  webhookId = crypto.randomUUID(),
  triggeredAt = new Date().toISOString(),
} = {}) {
  const headers = new Headers();
  if (hmac !== null) headers.set('x-shopify-hmac-sha256', hmac ?? sign(body));
  if (topic) headers.set('x-shopify-topic', topic);
  if (shop) headers.set('x-shopify-shop-domain', shop);
  if (webhookId) headers.set('x-shopify-webhook-id', webhookId);
  if (triggeredAt) headers.set('x-shopify-triggered-at', triggeredAt);

  return new Request('https://catalogpilot.test/api/webhooks', { method: 'POST', body, headers });
}

describe('verifyWebhook', () => {
  it('accepts a correctly signed webhook', async () => {
    const result = await verifyWebhook(webhookRequest());
    expect(result.topic).toBe('app/uninstalled');
    expect(result.shop).toBe(SHOP);
    expect(result.duplicate).toBe(false);
    expect(result.payload).toEqual({ id: 1 });
  });

  it('rejects a forged signature', async () => {
    await expect(verifyWebhook(webhookRequest({ hmac: 'not-the-real-hmac' }))).rejects.toThrow(WebhookError);
  });

  it('rejects a tampered body', async () => {
    const original = JSON.stringify({ id: 1 });
    const request = webhookRequest({ body: JSON.stringify({ id: 999 }), hmac: sign(original) });
    await expect(verifyWebhook(request)).rejects.toThrow(/HMAC/i);
  });

  it('rejects a missing signature', async () => {
    await expect(verifyWebhook(webhookRequest({ hmac: null }))).rejects.toThrow(/required headers/i);
  });

  it('rejects a missing topic', async () => {
    await expect(verifyWebhook(webhookRequest({ topic: '' }))).rejects.toThrow(/required headers/i);
  });

  it('rejects a shop domain that is not a myshopify domain', async () => {
    const body = JSON.stringify({ id: 1 });
    const request = webhookRequest({ body, hmac: sign(body), shop: 'attacker.example.com' });
    await expect(verifyWebhook(request)).rejects.toThrow(/myshopify/i);
  });

  it('rejects a delivery older than the replay window', async () => {
    const oldTimestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await expect(verifyWebhook(webhookRequest({ triggeredAt: oldTimestamp }))).rejects.toThrow(
      /time window/i
    );
  });

  it('flags a repeated webhook id as a duplicate', async () => {
    const webhookId = crypto.randomUUID();
    const first = await verifyWebhook(webhookRequest({ webhookId }));
    const second = await verifyWebhook(webhookRequest({ webhookId }));

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it('treats an unparseable body as an empty payload rather than failing', async () => {
    const body = 'not json at all';
    const result = await verifyWebhook(webhookRequest({ body, hmac: sign(body) }));
    expect(result.payload).toEqual({});
  });
});
