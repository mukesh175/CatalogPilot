import crypto from 'node:crypto';
import { env } from '../env.js';
import { safeEqual } from '../crypto.js';
import { logger } from '../logger.js';
import { isValidShopDomain } from './sessionToken.js';

/**
 * Webhook verification.
 *
 * Every webhook is authenticated by HMAC over the *raw* request body — the
 * parsed body is not usable because JSON re-serialization changes bytes.
 * Replays are rejected by remembering recently seen webhook ids.
 */

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const seen = new Map();

function pruneSeen(now) {
  for (const [id, ts] of seen) {
    if (now - ts > REPLAY_WINDOW_MS) seen.delete(id);
  }
}

export class WebhookError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
  }
}

/**
 * Verifies a webhook request and returns { topic, shop, webhookId, payload }.
 * Throws WebhookError — the route turns that into a 401 with no body.
 */
export async function verifyWebhook(request) {
  const raw = await request.text();
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256');
  const topic = request.headers.get('x-shopify-topic');
  const shop = request.headers.get('x-shopify-shop-domain');
  const webhookId = request.headers.get('x-shopify-webhook-id');
  const triggeredAt = request.headers.get('x-shopify-triggered-at');

  if (!hmacHeader || !topic || !shop) {
    throw new WebhookError('Webhook is missing required headers');
  }
  if (!isValidShopDomain(shop)) {
    throw new WebhookError('Webhook shop domain is not a valid myshopify domain');
  }

  const digest = crypto
    .createHmac('sha256', env().SHOPIFY_API_SECRET)
    .update(raw, 'utf8')
    .digest('base64');

  if (!safeEqual(digest, hmacHeader)) {
    logger.warn('webhook.hmac_mismatch', { topic, shop });
    throw new WebhookError('Webhook HMAC verification failed');
  }

  // Reject stale deliveries outright, then de-duplicate retries.
  if (triggeredAt) {
    const age = Date.now() - new Date(triggeredAt).getTime();
    if (Number.isFinite(age) && age > REPLAY_WINDOW_MS) {
      throw new WebhookError('Webhook delivery is outside the accepted time window', 408);
    }
  }

  const now = Date.now();
  pruneSeen(now);
  if (webhookId) {
    if (seen.has(webhookId)) {
      return { topic, shop, webhookId, payload: safeParse(raw), duplicate: true };
    }
    seen.set(webhookId, now);
  }

  return { topic, shop, webhookId, payload: safeParse(raw), duplicate: false };
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Webhook topics the app subscribes to. Mandatory compliance topics are
 * declared in shopify.app.toml and handled in app/api/webhooks.
 */
export const WEBHOOK_TOPICS = [
  'APP_UNINSTALLED',
  'APP_SUBSCRIPTIONS_UPDATE',
  'SHOP_UPDATE',
  'PRODUCTS_DELETE',
  'CUSTOMERS_DATA_REQUEST',
  'CUSTOMERS_REDACT',
  'SHOP_REDACT',
];
