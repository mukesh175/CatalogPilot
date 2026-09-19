'use client';

import { useState } from 'react';
import { useApi } from '../../../../lib/use-api.js';
import { api, formatNumber, formatDate } from '../../../../lib/client-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import { Card, Banner, Badge, Skeleton, PageHeader, ProgressBar } from '../../../../components/ui.jsx';

export default function BillingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, refresh } = useApi('/api/billing');
  const [changing, setChanging] = useState(null);

  const choose = async (plan) => {
    if (plan.tier === data.subscription.plan) return;

    const downgrade = plan.price < currentPlanPrice(data);
    if (downgrade) {
      const ok = await confirm({
        title: `Switch to ${plan.name}?`,
        body:
          plan.tier === 'FREE'
            ? 'Your paid subscription will be cancelled and scheduled syncs will stop. Your products and settings are kept.'
            : `Limits will drop to the ${plan.name} plan. Sources or schedules above the new limit will be paused.`,
        confirmLabel: `Switch to ${plan.name}`,
        destructive: true,
      });
      if (!ok) return;
    }

    setChanging(plan.tier);
    try {
      const result = await api.post('/api/billing', { plan: plan.tier, test: true });
      if (result.confirmationUrl) {
        // Shopify's approval screen has to be opened at the top level.
        window.open(result.confirmationUrl, '_top');
        return;
      }
      toast.success(`Switched to ${plan.name}.`);
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    } finally {
      setChanging(null);
    }
  };

  if (loading && !data) return <Skeleton height={320} />;
  if (error) return <Banner tone="critical">{error.message}</Banner>;

  const { subscription, usage, plans } = data;
  const current = plans.find((plan) => plan.tier === subscription.plan) || plans[0];

  return (
    <div className="cp-stack">
      <PageHeader
        title="Billing"
        description="Plans are billed by Shopify and appear on your regular Shopify invoice."
      />

      {subscription.status !== 'ACTIVE' ? (
        <Banner tone="warning" title={`Subscription ${subscription.status.toLowerCase()}`}>
          CatalogPilot is running on Free plan limits until the subscription is active again.
        </Banner>
      ) : null}

      <Card title="Current usage">
        <div className="row g-4">
          <UsageBar
            label="Products managed"
            used={usage.products}
            limit={current.limits.maxProducts}
          />
          <UsageBar label="Data sources" used={usage.sources} limit={current.limits.maxSources} />
          <UsageBar label="Rules" used={usage.rules} limit={current.limits.maxRules} />
        </div>

        {subscription.currentPeriodEnd ? (
          <p className="cp-subdued mt-3 mb-0" style={{ fontSize: 12.5 }}>
            Renews {formatDate(subscription.currentPeriodEnd)}
            {subscription.test ? ' · test charge' : ''}
          </p>
        ) : null}
      </Card>

      <div className="row g-3">
        {plans.map((plan) => {
          const isCurrent = plan.tier === subscription.plan;
          return (
            <div key={plan.tier} className="col-12 col-md-6 col-xl-3">
              <div
                className="cp-card h-100"
                style={isCurrent ? { borderColor: 'var(--cp-accent)', boxShadow: '0 0 0 1px var(--cp-accent)' } : undefined}
              >
                <div className="cp-card-body d-flex flex-column h-100">
                  <div className="cp-spread mb-2">
                    <h2 className="cp-h2">{plan.name}</h2>
                    {isCurrent ? <Badge tone="success">Current</Badge> : null}
                  </div>

                  <div className="cp-metric mb-1">
                    {plan.price === 0 ? 'Free' : `$${plan.price.toFixed(2)}`}
                  </div>
                  <div className="cp-subdued mb-3" style={{ fontSize: 12.5 }}>
                    {plan.price === 0 ? 'No charge' : 'per month'}
                    {plan.trialDays ? ` · ${plan.trialDays}-day trial` : ''}
                  </div>

                  <ul className="list-unstyled cp-stack-sm flex-grow-1 mb-4" style={{ fontSize: 13 }}>
                    {plan.features.map((feature) => (
                      <li key={feature} className="cp-inline align-items-start">
                        <span aria-hidden="true" style={{ color: 'var(--cp-success)' }}>
                          ✓
                        </span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    className={`cp-btn ${isCurrent ? '' : 'cp-btn-primary'} w-100`}
                    disabled={isCurrent || changing === plan.tier}
                    onClick={() => choose(plan)}
                  >
                    {isCurrent
                      ? 'Your plan'
                      : changing === plan.tier
                        ? 'Opening Shopify…'
                        : plan.price === 0
                          ? 'Switch to Free'
                          : `Choose ${plan.name}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Banner tone="info">
        Going over a plan limit never deletes anything. Rows beyond the limit are reported in the error
        center so you can decide whether to upgrade.
      </Banner>
    </div>
  );
}

function UsageBar({ label, used, limit }) {
  const unlimited = limit == null;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <div className="col-12 col-md-4">
      <div className="cp-spread mb-1">
        <span className="cp-metric-label">{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {formatNumber(used)} {unlimited ? '' : `/ ${formatNumber(limit)}`}
        </span>
      </div>
      {unlimited ? (
        <Badge tone="success">Unlimited</Badge>
      ) : (
        <ProgressBar value={used} max={limit} tone={percent > 90 ? undefined : 'success'} />
      )}
    </div>
  );
}

function currentPlanPrice(data) {
  return data.plans.find((plan) => plan.tier === data.subscription.plan)?.price ?? 0;
}
