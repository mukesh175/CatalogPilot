import { NextResponse } from 'next/server';
import prisma from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { verifyWebhook, WebhookError } from '../../../lib/shopify/webhooks.js';
import { handleUninstall } from '../../../lib/shopify/auth.js';
import { applySubscriptionWebhook } from '../../../services/billing.js';

/**
 * Single webhook endpoint.
 *
 * Shopify requires a response within 5 seconds, so handlers do the minimum
 * durable work and nothing that can block. Verification happens before the
 * payload is looked at — an unverified body is never parsed for meaning.
 */
export async function POST(request) {
  let verified;
  try {
    verified = await verifyWebhook(request);
  } catch (error) {
    if (error instanceof WebhookError) {
      return new NextResponse(null, { status: error.status });
    }
    logger.error('webhook.verification_error', { error });
    return new NextResponse(null, { status: 401 });
  }

  const { topic, shop, payload, duplicate, webhookId } = verified;

  // A retry of something already processed is acknowledged, not repeated.
  if (duplicate) {
    logger.info('webhook.duplicate_ignored', { topic, shop, webhookId });
    return new NextResponse(null, { status: 200 });
  }

  try {
    await dispatch(topic, shop, payload);
    logger.info('webhook.processed', { topic, shop, webhookId });
  } catch (error) {
    logger.error('webhook.handler_failed', { topic, shop, error });
    // A 500 makes Shopify retry, which is what we want for a transient fault.
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 200 });
}

async function dispatch(topic, shop, payload) {
  switch (topic) {
    case 'app/uninstalled':
      await handleUninstall(shop);
      return;

    case 'app_subscriptions/update':
      await applySubscriptionWebhook(shop, payload);
      return;

    case 'shop/update':
      await prisma.shop.updateMany({
        where: { domain: shop },
        data: {
          name: payload.name || undefined,
          email: payload.email || undefined,
          currencyCode: payload.currency || undefined,
          countryCode: payload.country_code || undefined,
        },
      });
      return;

    case 'products/delete': {
      // The product is gone from Shopify; dropping the mapping lets the next
      // sync recreate it rather than failing to update a missing product.
      const gid = `gid://shopify/Product/${payload.id}`;
      const shopRecord = await prisma.shop.findUnique({ where: { domain: shop }, select: { id: true } });
      if (!shopRecord) return;
      await prisma.productMapping.deleteMany({
        where: { shopId: shopRecord.id, shopifyProductId: gid },
      });
      return;
    }

    // ---- Mandatory compliance topics -------------------------------------
    // CatalogPilot stores no customer personal data: it reads supplier product
    // sheets and writes products. These handlers acknowledge the request and
    // record it, which is what the topics require of an app holding no
    // customer data.
    case 'customers/data_request':
      logger.info('webhook.gdpr_data_request', { shop, customerId: payload?.customer?.id });
      return;

    case 'customers/redact':
      logger.info('webhook.gdpr_customer_redact', { shop, customerId: payload?.customer?.id });
      return;

    case 'shop/redact':
      await purgeShopData(shop);
      return;

    default:
      logger.warn('webhook.unhandled_topic', { topic, shop });
  }
}

/**
 * Deletes everything held for a shop, 48 hours after uninstall.
 * The cascade on Shop removes sessions, sources, mappings, jobs and history.
 */
async function purgeShopData(shopDomain) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain }, select: { id: true } });
  if (!shop) return;
  await prisma.shop.delete({ where: { id: shop.id } });
  logger.info('webhook.shop_redacted', { shopId: shop.id });
}
