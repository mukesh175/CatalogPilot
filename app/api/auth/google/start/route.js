import { withAuth, json, apiError } from '../../../../../lib/api.js';
import { signState } from '../../../../../lib/crypto.js';
import { buildConsentUrl, googleOAuthEnabled } from '../../../../../lib/google/oauth.js';

/**
 * Begins the Google consent flow.
 *
 * The shop identity is taken from the authenticated Shopify session and sealed
 * into a signed state token, so the callback can trust it without accepting a
 * shop parameter from the browser.
 */
export const GET = withAuth(async (request, { shopId, shop, userId }) => {
  // Refused server-side too, so a stale page or a direct call cannot start a
  // flow that Google will only block.
  if (!googleOAuthEnabled()) {
    return apiError('Signing in with Google is not available yet.', {
      status: 503,
      code: 'google_oauth_disabled',
      details: { suggestion: 'Connect your sheet by link instead.' },
    });
  }

  const state = signState({ shopId, shop, userId: userId || null, purpose: 'google_connect' });
  return json({ url: buildConsentUrl(state) });
});
