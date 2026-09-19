'use client';

import Link from 'next/link';
import { useApi } from '../../../lib/use-api.js';
import { api, formatNumber, formatRelative } from '../../../lib/client-api.js';
import { useToast } from '../../../components/AppProviders.jsx';
import { Card, Banner, EmptyState, SkeletonTable, Badge, StatusBadge, PageHeader } from '../../../components/ui.jsx';
import { ConnectByLink } from '../../../components/ConnectByLink.jsx';

const SCHEDULE_LABELS = {
  MANUAL: 'Manual only',
  HOURLY: 'Every hour',
  EVERY_6_HOURS: 'Every 6 hours',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

export default function SourcesPage() {
  const toast = useToast();
  const { data, loading, error, refresh } = useApi('/api/sources');
  const sources = (data?.sources || []).filter(
    (source) => source.kind === 'GOOGLE_SHEET' || source.kind === 'GOOGLE_SHEET_SERVICE'
  );

  const runSync = async (source) => {
    try {
      await api.post('/api/jobs', { dataSourceId: source.id, kind: 'PREVIEW' });
      toast.success('Building a preview of the changes…');
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  return (
    <div className="cp-stack">
      <PageHeader
        title="Google Sheets"
        description="The supplier spreadsheets CatalogPilot reads from."
        actions={
          <Link href="/onboarding" className="cp-btn cp-btn-primary">
            Connect a sheet
          </Link>
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      <ConnectByLink onConnected={refresh} />

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={3} columns={5} />
        ) : sources.length === 0 ? (
          <EmptyState
            icon="⬡"
            title="No sources connected"
            description="Connect your supplier spreadsheet to start importing your catalog."
            action={
              <Link href="/onboarding" className="cp-btn cp-btn-primary">
                Connect a sheet
              </Link>
            }
          />
        ) : (
          <div className="cp-table-wrap">
            <table className="cp-table">
              <caption className="cp-visually-hidden">Connected data sources</caption>
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Worksheet</th>
                  <th scope="col">Schedule</th>
                  <th scope="col">Last sync</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="cp-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <Link href={`/sources/${source.id}`} style={{ fontWeight: 550 }}>
                        {source.name}
                      </Link>
                      <div className="cp-subdued" style={{ fontSize: 12 }}>
                        {source.kind === 'GOOGLE_SHEET_SERVICE'
                          ? 'Shared with CatalogPilot'
                          : source.connection?.email || 'No Google account'}
                      </div>
                    </td>
                    <td>
                      {source.worksheet ? (
                        <>
                          {source.worksheet.title}
                          <div className="cp-subdued" style={{ fontSize: 12 }}>
                            {formatNumber(source.worksheet.rowCount)} rows
                          </div>
                        </>
                      ) : (
                        <span className="cp-subdued">Not selected</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={source.schedule === 'MANUAL' ? 'default' : 'info'}>
                        {SCHEDULE_LABELS[source.schedule]}
                      </Badge>
                      {source.isPaused ? (
                        <div className="mt-1">
                          <Badge tone="warning">Paused</Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="cp-subdued">
                      {source.lastSync ? (
                        <>
                          {formatRelative(source.lastSync.startedAt)}
                          <div style={{ fontSize: 12 }}>
                            {formatNumber(source.lastSync.created)} new ·{' '}
                            {formatNumber(source.lastSync.updated)} updated
                          </div>
                        </>
                      ) : (
                        'Never'
                      )}
                    </td>
                    <td>
                      <StatusBadge status={source.status} />
                    </td>
                    <td>
                      <div className="cp-inline">
                        <button
                          type="button"
                          className="cp-btn cp-btn-sm"
                          onClick={() => runSync(source)}
                          disabled={source.status !== 'READY'}
                          title={source.status !== 'READY' ? 'Finish mapping this source first' : undefined}
                        >
                          Preview sync
                        </button>
                        <Link href={`/sources/${source.id}`} className="cp-btn cp-btn-sm">
                          Configure
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
