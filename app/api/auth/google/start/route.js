import { withAuth, json } from '../../../../../lib/api.js';
import { signState } from '../../../../../lib/crypto.js';
import { buildConsentUrl } from '../../../../../lib/google/oauth.js';

/**
 * Begins the Google consent flow.
 *
 * The shop identity is taken from the authenticated Shopify session and sealed
 * into a signed state token, so the callback can trust it without accepting a
 * shop parameter from the browser.
 */
export const GET = withAuth(async (request, { shopId, shop, userId }) => {
  const state = signState({ shopId, shop, userId: userId || null, purpose: 'google_connect' });
  return json({ url: buildConsentUrl(state) });
});
