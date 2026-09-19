import prisma from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';
import { PLANS, planConfig, PLAN_ORDER } from '../lib/plans.js';
import { assertNoUserErrors } from '../lib/shopify/client.js';
import { CREATE_SUBSCRIPTION, CANCEL_SUBSCRIPTION, CURRENT_SUBSCRIPTIONS } from '../graphql/billing.js';

/**
 * Billing through the Shopify Billing API.
 *
 * Entitlement is always read from the database record, which is kept in step
 * with Shopify by the APP_SUBSCRIPTIONS_UPDATE webhook and by an explicit
 * reconcile on the billing page. No component decides what a merchant may do.
 */

export async function currentSubscription(shopId) {
  const subscription = await prisma.billingSubscription.findUnique({ where: { shopId } });
  if (subscription) return subscription;
  return prisma.billingSubscription.create({
    data: { shopId, plan: 'FREE', status: 'ACTIVE' },
  });
}

/** The effective limits for a shop, including current usage. */
export async function planLimits(shopId) {
  const subscription = await currentSubscription(shopId);
  const active = subscription.status === 'ACTIVE';
  const tier = active ? subscription.plan : 'FREE';
  const config = planConfig(tier);

  return {
    tier,
    label: config.name,
    ...config.limits,
  };
}

/** Usage counters shown on the billing page and enforced before a sync. */
export async function planUsage(shopId) {
  const [products, sources, rules] = await Promise.all([
    prisma.productMapping.count({ where: { shopId } }),
    prisma.dataSource.count({ where: { shopId, status: { not: 'DISCONNECTED' } } }),
    prisma.syncRule.count({ where: { shopId } }),
  ]);
  return { products, sources, rules };
}

/**
 * Checks an action against the plan.
 * Returns { allowed, reason, upgradeTo } — the caller turns a denial into a
 * 402 with an upgrade prompt rather than a generic error.
 */
export async function checkEntitlement(shopId, action, { count = 1, schedule = null } = {}) {
  const limits = await planLimits(shopId);
  const usage = await planUsage(shopId);

  switch (action) {
    case 'add_source':
      if (limits.maxSources != null && usage.sources + count > limits.maxSources) {
        return deny(
          `The ${limits.label} plan includes ${limits.maxSources} data source${limits.maxSources === 1 ? '' : 's'}.`,
          limits.tier
        );
      }
      return { allowed: true };

    case 'add_rule':
      if (limits.maxRules != null && usage.rules + count > limits.maxRules) {
        return deny(`The ${limits.label} plan includes ${limits.maxRules} rules.`, limits.tier);
      }
      return { allowed: true };

    case 'schedule': {
      if (schedule && schedule !== 'MANUAL' && !limits.schedules.includes(schedule)) {
        return deny(`Scheduled sync is not available on the ${limits.label} plan.`, limits.tier);
      }
      return { allowed: true };
    }

    case 'sync_products':
      if (limits.maxProducts != null && count > limits.maxProducts) {
        return deny(
          `The ${limits.label} plan covers ${limits.maxProducts.toLocaleString()} products, and this sync would reach ${count.toLocaleString()}.`,
          limits.tier
        );
      }
      return { allowed: true };

    default:
      return { allowed: true };
  }
}

function deny(reason, currentTier) {
  const index = PLAN_ORDER.indexOf(currentTier);
  return {
    allowed: false,
    reason,
    upgradeTo: PLAN_ORDER[Math.min(index + 1, PLAN_ORDER.length - 1)],
  };
}

/**
 * Starts a plan change. Returns the Shopify confirmation URL the merchant must
 * approve — the subscription is not active until they do, and the webhook is
 * what flips the stored record.
 */
export async function beginSubscription({ admin, shopId, shopDomain, tier, test = false }) {
  const config = PLANS[tier];
  if (!config) throw new Error(`Unknown plan "${tier}"`);

  if (tier === 'FREE') {
    return downgradeToFree({ admin, shopId });
  }

  const returnUrl = `${env().APP_URL}/api/billing/callback?shop=${encodeURIComponent(shopDomain)}&plan=${tier}`;

  const data = await admin.request(
    CREATE_SUBSCRIPTION,
    {
      name: `CatalogPilot ${config.name}`,
      returnUrl,
      test,
      trialDays: config.trialDays || 0,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: config.price, currencyCode: config.currency },
              interval: config.interval,
            },
          },
        },
      ],
    },
    { operation: 'CreateSubscription' }
  );

  assertNoUserErrors(data.appSubscriptionCreate, 'appSubscriptionCreate');
  const { appSubscription, confirmationUrl } = data.appSubscriptionCreate;

  await prisma.billingSubscription.upsert({
    where: { shopId },
    create: {
      shopId,
      plan: tier,
      status: 'PENDING',
      shopifyChargeId: appSubscription.id,
      confirmationUrl,
      test,
    },
    update: {
      plan: tier,
      status: 'PENDING',
      shopifyChargeId: appSubscription.id,
      confirmationUrl,
      test,
      cancelledAt: null,
    },
  });

  logger.info('billing.subscription_started', { shopId, tier, test });
  return { confirmationUrl, plan: tier };
}

async function downgradeToFree({ admin, shopId }) {
  const existing = await prisma.billingSubscription.findUnique({ where: { shopId } });
  if (existing?.shopifyChargeId && existing.status === 'ACTIVE') {
    const data = await admin.request(
      CANCEL_SUBSCRIPTION,
      { id: existing.shopifyChargeId },
      { operation: 'CancelSubscription' }
    );
    assertNoUserErrors(data.appSubscriptionCancel, 'appSubscriptionCancel');
  }

  await prisma.billingSubscription.upsert({
    where: { shopId },
    create: { shopId, plan: 'FREE', status: 'ACTIVE' },
    update: {
      plan: 'FREE',
      status: 'ACTIVE',
      shopifyChargeId: null,
      confirmationUrl: null,
      cancelledAt: new Date(),
    },
  });

  logger.info('billing.downgraded', { shopId });
  return { confirmationUrl: null, plan: 'FREE' };
}

/**
 * Reconciles the stored record against Shopify's view.
 * Called after the merchant returns from the confirmation page and whenever
 * the billing screen loads, so a missed webhook cannot strand a paying shop.
 */
export async function reconcileSubscription({ admin, shopId }) {
  const data = await admin.request(CURRENT_SUBSCRIPTIONS, {}, { operation: 'CurrentSubscriptions' });
  const active = data.currentAppInstallation?.activeSubscriptions || [];

  if (active.length === 0) {
    await prisma.billingSubscription.upsert({
      where: { shopId },
      create: { shopId, plan: 'FREE', status: 'ACTIVE' },
      update: { plan: 'FREE', status: 'ACTIVE', shopifyChargeId: null, confirmationUrl: null },
    });
    return { plan: 'FREE', status: 'ACTIVE' };
  }

  const subscription = active[0];
  const tier = tierFromName(subscription.name);

  const updated = await prisma.billingSubscription.upsert({
    where: { shopId },
    create: {
      shopId,
      plan: tier,
      status: subscription.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
      shopifyChargeId: subscription.id,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
      test: subscription.test,
    },
    update: {
      plan: tier,
      status: subscription.status === 'ACTIVE' ? 'ACTIVE' : 'PENDING',
      shopifyChargeId: subscription.id,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
      confirmationUrl: null,
      test: subscription.test,
    },
  });

  logger.info('billing.reconciled', { shopId, plan: updated.plan, status: updated.status });
  return updated;
}

/** Applies an APP_SUBSCRIPTIONS_UPDATE webhook payload. */
export async function applySubscriptionWebhook(shopDomain, payload) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return null;

  const subscription = payload.app_subscription || {};
  const tier = tierFromName(subscription.name);
  const status = mapStatus(subscription.status);

  const record = await prisma.billingSubscription.upsert({
    where: { shopId: shop.id },
    create: {
      shopId: shop.id,
      plan: status === 'ACTIVE' ? tier : 'FREE',
      status,
      shopifyChargeId: subscription.admin_graphql_api_id || null,
    },
    update: {
      plan: status === 'ACTIVE' ? tier : 'FREE',
      status,
      shopifyChargeId: subscription.admin_graphql_api_id || null,
      confirmationUrl: null,
      cancelledAt: status === 'CANCELLED' ? new Date() : null,
    },
  });

  // Losing a paid plan must also stop paid-only automation.
  if (status !== 'ACTIVE') {
    await prisma.dataSource.updateMany({
      where: { shopId: shop.id, schedule: { not: 'MANUAL' } },
      data: { schedule: 'MANUAL', nextRunAt: null },
    });
  }

  logger.info('billing.webhook_applied', { shopId: shop.id, plan: record.plan, status });
  return record;
}

function tierFromName(name = '') {
  const match = PLAN_ORDER.find((tier) => name.toLowerCase().includes(PLANS[tier].name.toLowerCase()));
  return match || 'FREE';
}

function mapStatus(status = '') {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'ACTIVE';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'FROZEN':
      return 'FROZEN';
    case 'DECLINED':
      return 'DECLINED';
    default:
      return 'PENDING';
  }
}
