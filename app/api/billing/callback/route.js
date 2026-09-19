import { NextResponse } from 'next/server';
import prisma from '../../../../lib/prisma.js';
import { env } from '../../../../lib/env.js';
import { logger } from '../../../../lib/logger.js';
import { withErrorHandling } from '../../../../lib/api.js';
import { adminClientForShop } from '../../../../lib/shopify/auth.js';
import { normalizeShopDomain } from '../../../../lib/shopify/sessionToken.js';
import { reconcileSubscription } from '../../../../services/billing.js';

/**
 * Where Shopify sends the merchant after they approve or decline a charge.
 *
 * The URL is not authenticated, so nothing here trusts it: the shop is
 * re-validated, and the real subscription state is read back from Shopify
 * rather than taken from the query string.
 */
export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const shopDomain = normalizeShopDomain(url.searchParams.get('shop'));

  if (!shopDomain) {
    return NextResponse.redirect(new URL('/billing?status=invalid', env().APP_URL).toString());
  }

  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop || !shop.isActive) {
    return NextResponse.redirect(new URL('/billing?status=unknown_shop', env().APP_URL).toString());
  }

  try {
    const admin = await adminClientForShop(shopDomain);
    const subscription = await reconcileSubscription({ admin, shopId: shop.id });
    logger.info('billing.callback', { shopId: shop.id, plan: subscription.plan, status: subscription.status });
  } catch (error) {
    logger.error('billing.callback_failed', { shop: shopDomain, error });
  }

  const storeHandle = shopDomain.replace('.myshopify.com', '');
  const target = new URL(
    `https://admin.shopify.com/store/${storeHandle}/apps/${env().SHOPIFY_API_KEY}/settings/billing`
  );
  target.searchParams.set('status', 'updated');
  return NextResponse.redirect(target.toString());
});
