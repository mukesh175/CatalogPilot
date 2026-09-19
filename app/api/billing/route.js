import { withAuth, json, apiError, parseBody } from '../../../lib/api.js';
import { billingSchema } from '../../../validators/index.js';
import {
  currentSubscription,
  planUsage,
  beginSubscription,
  reconcileSubscription,
} from '../../../services/billing.js';
import { PLANS, PLAN_ORDER } from '../../../lib/plans.js';

export const GET = withAuth(async (request, { shopId, admin, log }) => {
  // Reconciling on load means a missed webhook cannot leave a paying merchant
  // looking like they are on Free.
  let subscription;
  try {
    subscription = await reconcileSubscription({ admin, shopId });
  } catch (error) {
    log.warn('billing.reconcile_failed', { error });
    subscription = await currentSubscription(shopId);
  }

  return json({
    subscription: {
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      test: subscription.test,
    },
    usage: await planUsage(shopId),
    plans: PLAN_ORDER.map((tier) => ({
      tier,
      name: PLANS[tier].name,
      price: PLANS[tier].price,
      currency: PLANS[tier].currency,
      trialDays: PLANS[tier].trialDays,
      features: PLANS[tier].features,
      limits: PLANS[tier].limits,
    })),
  });
});

/** Starts a plan change and returns the Shopify confirmation URL. */
export const POST = withAuth(async (request, { shopId, shop, admin }) => {
  const { plan, test } = await parseBody(request, billingSchema);

  const result = await beginSubscription({
    admin,
    shopId,
    shopDomain: shop,
    tier: plan,
    // Test charges are only available on a development store; the flag is
    // accepted but ignored in production so a live shop cannot be billed $0.
    test: process.env.NODE_ENV !== 'production' && Boolean(test),
  });

  if (!result.confirmationUrl && result.plan === 'FREE') {
    return json({ plan: 'FREE', confirmationUrl: null, downgraded: true });
  }
  if (!result.confirmationUrl) {
    return apiError('Shopify did not return a confirmation URL.', { status: 502, code: 'billing_failed' });
  }

  return json(result);
});
