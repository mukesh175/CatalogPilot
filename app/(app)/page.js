'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApi } from '../../lib/use-api.js';
import { formatNumber, formatDuration, formatRelative } from '../../lib/client-api.js';
import {
  Card,
  MetricCard,
  Banner,
  EmptyState,
  Skeleton,
  SkeletonTable,
  StatusBadge,
  ProgressBar,
  PageHeader,
} from '../../components/ui.jsx';
import { SyncTrend } from '../../components/SyncTrend.jsx';

export default function DashboardPage() {
  const router = useRouter();
  // Poll while a job is running so progress is live without a refresh.
  const { data, loading, error } = useApi('/api/dashboard', { pollMs: 4000 });

  useEffect(() => {
    if (data && !data.shop.onboardingDone && data.metrics.sources === 0) {
      router.replace('/onboarding');
    }
  }, [data, router]);

  if (loading && !data) return <DashboardSkeleton />;

  if (error) {
    return (
      <Banner tone="critical" title="Could not load your dashboard">
        {error.message}
      </Banner>
    );
  }

  if (!data) return null;

  const { metrics, attention, activeJob, recentActivity, plan, trend } = data;

  if (metrics.sources === 0) {
    return (
      <Card>
        <EmptyState
          icon="⬡"
          title="Connect your first supplier sheet"
          description="CatalogPilot reads your supplier spreadsheet, maps it to Shopify fields, and keeps your catalog up to date automatically."
          action={
            <Link href="/onboarding" className="cp-btn cp-btn-primary">
              Connect Google Sheet
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="cp-stack-lg">
      <PageHeader
        title="Dashboard"
        description={`${data.shop.name || data.shop.domain} · ${plan.label} plan`}
        actions={
          <Link href="/sync/preview" className="cp-btn cp-btn-primary">
            Run a sync
          </Link>
        }
      />

      {attention.length > 0 ? (
        <div className="cp-stack-sm">
          {attention.map((item) => (
            <Banner
              key={item.kind}
              tone={item.severity === 'error' ? 'critical' : 'warning'}
              title={item.title}
              action={
                <Link href={item.href} className="cp-btn cp-btn-sm">
                  {item.action}
                </Link>
              }
            >
              {item.description}
            </Banner>
          ))}
        </div>
      ) : null}

      {activeJob ? (
        <Card title={`${activeJob.kind === 'PREVIEW' ? 'Building preview' : 'Syncing products'}`}>
          <div className="cp-stack-sm">
            <ProgressBar
              value={activeJob.processed}
              max={activeJob.total || 1}
              label={`${formatNumber(activeJob.processed)} / ${formatNumber(activeJob.total)} rows · ${activeJob.source?.name || ''}`}
            />
            <Link href={`/sync/preview?jobId=${activeJob.id}`} className="cp-btn cp-btn-sm">
              View progress
            </Link>
          </div>
        </Card>
      ) : null}

      <div className="row g-3">
        <div className="col-6 col-lg-3">
          <MetricCard
            label="Products managed"
            value={formatNumber(metrics.productsManaged)}
            hint={`${formatNumber(metrics.variantsManaged)} variants`}
          />
        </div>
        <div className="col-6 col-lg-3">
          <MetricCard
            label="Sync health"
            value={metrics.health == null ? '—' : `${metrics.health}%`}
            hint="Rows synced without error, 30 days"
            tone={metrics.health != null && metrics.health < 95 ? 'warning' : 'success'}
          />
        </div>
        <div className="col-6 col-lg-3">
          <MetricCard
            label="Need attention"
            value={formatNumber(metrics.openErrors)}
            hint={metrics.openErrors > 0 ? 'Open the error center' : 'Nothing to review'}
            tone={metrics.openErrors > 0 ? 'critical' : undefined}
          />
        </div>
        <div className="col-6 col-lg-3">
          <MetricCard
            label="Connected sources"
            value={formatNumber(metrics.sources)}
            hint={plan.maxSources ? `${plan.maxSources} on ${plan.label}` : 'Unlimited'}
          />
        </div>
      </div>

      <div className="row g-3">
        <div className="col-12 col-lg-7">
          <Card
            title="Catalog activity"
            actions={
              <Link href="/sync/history" className="cp-btn cp-btn-sm">
                Full history
              </Link>
            }
          >
            <SyncTrend data={trend} />
            <div className="cp-inline mt-4" style={{ fontSize: 12.5 }}>
              <span className="cp-inline">
                <span className="cp-dot" style={{ color: 'var(--cp-success)' }} /> Created
              </span>
              <span className="cp-inline">
                <span className="cp-dot" style={{ color: 'var(--cp-info)' }} /> Updated
              </span>
              <span className="cp-inline">
                <span className="cp-dot" style={{ color: 'var(--cp-critical)' }} /> Failed
              </span>
            </div>
          </Card>
        </div>

        <div className="col-12 col-lg-5">
          <Card title="Recent syncs" padded={false}>
            {recentActivity.length === 0 ? (
              <div className="cp-card-body">
                <p className="cp-subdued mb-0">No syncs have run yet.</p>
              </div>
            ) : (
              <div className="cp-table-wrap">
                <table className="cp-table">
                  <caption className="cp-visually-hidden">Recent sync runs</caption>
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Result</th>
                      <th scope="col" className="cp-table-numeric">
                        When
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivity.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <Link href={`/sync/history?jobId=${run.jobId}`} className="cp-truncate d-block">
                            {run.source?.name || 'Source'}
                          </Link>
                          <span className="cp-subdued" style={{ fontSize: 12 }}>
                            {formatNumber(run.created)} new · {formatNumber(run.updated)} updated
                            {run.failed > 0 ? ` · ${formatNumber(run.failed)} failed` : ''}
                          </span>
                        </td>
                        <td>
                          <StatusBadge status={run.status} />
                        </td>
                        <td className="cp-table-numeric cp-subdued" style={{ fontSize: 12.5 }}>
                          {formatRelative(run.startedAt)}
                          <div>{formatDuration(run.durationMs)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="cp-stack-lg" aria-busy="true">
      <Skeleton height={28} width={200} />
      <div className="row g-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="col-6 col-lg-3">
            <div className="cp-card cp-metric-card">
              <Skeleton height={12} width="60%" />
              <Skeleton height={28} width="45%" className="mt-2" />
            </div>
          </div>
        ))}
      </div>
      <div className="cp-card">
        <SkeletonTable rows={5} columns={3} />
      </div>
    </div>
  );
}
