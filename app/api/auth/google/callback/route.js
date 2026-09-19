import { NextResponse } from 'next/server';
import prisma from '../../../../../lib/prisma.js';
import { env } from '../../../../../lib/env.js';
import { verifyState } from '../../../../../lib/crypto.js';
import { logger } from '../../../../../lib/logger.js';
import { withErrorHandling } from '../../../../../lib/api.js';
import { completeConnection } from '../../../../../lib/google/oauth.js';

/**
 * Google OAuth callback.
 *
 * Runs outside the embedded frame (Google refuses to render in an iframe), so
 * it finishes by redirecting back into the Shopify admin. The signed state is
 * the only thing that ties this request to a shop.
 */
export const GET = withErrorHandling(async (request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    logger.info('google.consent_denied', { reason: error });
    return redirectToApp({ status: 'denied' });
  }

  const payload = verifyState(state);
  if (!payload || payload.purpose !== 'google_connect') {
    logger.warn('google.callback_bad_state', {});
    return redirectToApp({ status: 'invalid_state' });
  }
  if (!code) return redirectToApp({ status: 'missing_code' });

  const shop = await prisma.shop.findUnique({ where: { id: payload.shopId } });
  if (!shop || !shop.isActive) return redirectToApp({ status: 'unknown_shop' });

  const user = payload.userId
    ? await prisma.user.findUnique({
        where: { shopId_shopifyUserId: { shopId: shop.id, shopifyUserId: payload.userId } },
      })
    : null;

  await completeConnection({ code, shopId: shop.id, userId: user?.id || null });

  return redirectToApp({ status: 'connected', shop: shop.domain });
});

/**
 * Sends the merchant back into the embedded app.
 * Shopify's admin URL is used rather than the app URL so the app reopens inside
 * the admin frame with a valid session, instead of standing alone.
 */
function redirectToApp({ status, shop }) {
  const { SHOPIFY_API_KEY, APP_URL } = env();

  if (shop) {
    const storeHandle = shop.replace('.myshopify.com', '');
    const target = new URL(`https://admin.shopify.com/store/${storeHandle}/apps/${SHOPIFY_API_KEY}/onboarding/source`);
    target.searchParams.set('google', status);
    return NextResponse.redirect(target.toString());
  }

  const fallback = new URL('/connection-result', APP_URL);
  fallback.searchParams.set('status', status);
  return NextResponse.redirect(fallback.toString());
}
