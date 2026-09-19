/**
 * Plan definitions — server-side configuration, never imported by a component
 * that makes an entitlement decision. The UI renders what the server says the
 * merchant is entitled to; it does not compute it.
 */

export const PLANS = {
  FREE: {
    tier: 'FREE',
    name: 'Free',
    price: 0,
    currency: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 0,
    limits: {
      maxProducts: 100,
      maxSources: 1,
      schedules: ['MANUAL'],
      maxRules: 3,
      advancedAutomation: false,
      prioritySupport: false,
    },
    features: [
      'Up to 100 products',
      '1 connected sheet',
      'Manual sync',
      'Smart column mapping',
      'Sync preview and error center',
    ],
  },
  STARTER: {
    tier: 'STARTER',
    name: 'Starter',
    price: 9.99,
    currency: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 7,
    limits: {
      maxProducts: 2000,
      maxSources: 1,
      schedules: ['MANUAL', 'DAILY', 'WEEKLY'],
      maxRules: 10,
      advancedAutomation: false,
      prioritySupport: false,
    },
    features: [
      'Up to 2,000 products',
      'Scheduled sync (daily, weekly)',
      'Price and inventory rules',
      'Collection and tag automation',
    ],
  },
  GROWTH: {
    tier: 'GROWTH',
    name: 'Growth',
    price: 19.99,
    currency: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 7,
    limits: {
      maxProducts: 10000,
      maxSources: 5,
      schedules: ['MANUAL', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY'],
      maxRules: 50,
      advancedAutomation: true,
      prioritySupport: false,
    },
    features: [
      'Up to 10,000 products',
      'Multiple data sources',
      'Sync every 6 hours',
      'Conditional pricing rules',
    ],
  },
  PRO: {
    tier: 'PRO',
    name: 'Pro',
    price: 39.99,
    currency: 'USD',
    interval: 'EVERY_30_DAYS',
    trialDays: 7,
    limits: {
      maxProducts: null, // unlimited
      maxSources: 25,
      schedules: ['MANUAL', 'HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY'],
      maxRules: null,
      advancedAutomation: true,
      prioritySupport: true,
    },
    features: [
      'Unlimited products',
      'Hourly sync',
      'Up to 25 data sources',
      'Priority support',
    ],
  },
};

export const PLAN_ORDER = ['FREE', 'STARTER', 'GROWTH', 'PRO'];

export function planConfig(tier) {
  return PLANS[tier] || PLANS.FREE;
}

/** Human label for a schedule value. */
export const SCHEDULE_LABELS = {
  MANUAL: 'Manual only',
  HOURLY: 'Every hour',
  EVERY_6_HOURS: 'Every 6 hours',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

/** Milliseconds between runs for each schedule. */
export const SCHEDULE_INTERVALS = {
  HOURLY: 60 * 60 * 1000,
  EVERY_6_HOURS: 6 * 60 * 60 * 1000,
  DAILY: 24 * 60 * 60 * 1000,
  WEEKLY: 7 * 24 * 60 * 60 * 1000,
};
