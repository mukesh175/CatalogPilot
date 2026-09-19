'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '../../../../lib/use-api.js';
import { api, formatNumber, formatDate, formatRelative } from '../../../../lib/client-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import { MappingTable } from '../../../../components/MappingTable.jsx';
import {
  Card,
  Banner,
  Skeleton,
  Badge,
  StatusBadge,
  PageHeader,
} from '../../../../components/ui.jsx';

const SCHEDULE_LABELS = {
  MANUAL: 'Manual only',
  HOURLY: 'Every hour',
  EVERY_6_HOURS: 'Every 6 hours',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

export default function SourceDetailPage({ params }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, error, refresh } = useApi(`/api/sources/${id}`);
  const mappingsApi = useApi(`/api/sources/${id}/mappings`);
  const [mappings, setMappings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (mappingsApi.data?.mappings) setMappings(mappingsApi.data.mappings);
  }, [mappingsApi.data]);

  const source = data?.source;

  const patch = async (body, message) => {
    try {
      await api.patch(`/api/sources/${id}`, body);
      toast.success(message);
      refresh();
    } catch (caught) {
      if (caught.code === 'plan_limit') {
        toast.error(`${caught.message} Open Settings → Billing to upgrade.`);
      } else {
        toast.error(caught.message);
      }
      refresh();
    }
  };

  const saveMappings = async () => {
    setSaving(true);
    try {
      const result = await api.put(`/api/sources/${id}/mappings`, {
        mappings: mappings.map((m) => ({
          sourceColumn: m.sourceColumn,
          targetField: m.isIgnored ? null : m.targetField,
          confidence: m.confidence,
          score: m.score,
          isConfirmed: m.isConfirmed,
          isIgnored: m.isIgnored,
        })),
      });
      setMappings(result.mappings);
      if (result.validation.ok) toast.success('Mapping saved. This source is ready to sync.');
      else
        toast.error(
          result.validation.missing.length
            ? `Still missing: ${result.validation.missing.map((m) => m.label).join(', ')}`
            : 'Some columns still need review.'
        );
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect this source?',
      body: 'Future syncs will stop. The products already in your Shopify store are not changed or removed.',
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/sources/${id}`);
      toast.success('Source disconnected.');
      router.push('/sources');
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  const runPreview = async () => {
    try {
      const result = await api.post('/api/jobs', { dataSourceId: id, kind: 'PREVIEW' });
      router.push(`/sync/preview?jobId=${result.job.id}`);
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  if (loading && !source) return <Skeleton height={300} />;
  if (error) return <Banner tone="critical">{error.message}</Banner>;
  if (!source) return null;

  return (
    <div className="cp-stack">
      <PageHeader
        backHref="/sources"
        backLabel="Sources"
        title={source.name}
        description={source.connection?.email ? `Connected as ${source.connection.email}` : undefined}
        actions={
          <>
            <button type="button" className="cp-btn" onClick={disconnect}>
              Disconnect
            </button>
            <button
              type="button"
              className="cp-btn cp-btn-primary"
              onClick={runPreview}
              disabled={source.status !== 'READY'}
            >
              Preview sync
            </button>
          </>
        }
      />

      {source.connection?.isRevoked ? (
        <Banner
          tone="critical"
          title="Google connection expired"
          action={
            <a href="/settings/connections" className="cp-btn cp-btn-sm">
              Reconnect
            </a>
          }
        >
          CatalogPilot can no longer read this spreadsheet.
        </Banner>
      ) : null}

      {source.status !== 'READY' ? (
        <Banner tone="warning" title="This source is not ready to sync">
          Finish reviewing the column mapping below. Required fields are Title and SKU.
        </Banner>
      ) : null}

      <div className="row g-3">
        <div className="col-12 col-lg-4">
          <Card title="Sync schedule">
            <div className="cp-field">
              <label className="cp-label" htmlFor="schedule">
                Run this sync
              </label>
              <select
                id="schedule"
                className="cp-select"
                value={source.schedule}
                onChange={(event) => patch({ schedule: event.target.value }, 'Schedule updated.')}
              >
                {/*
                  The list comes from the server, which already filters it by
                  the plan and by what the host can actually run — so no option
                  here can be chosen and then rejected on save.
                */}
                {(source.availableSchedules || ['MANUAL']).map((value) => (
                  <option key={value} value={value}>
                    {SCHEDULE_LABELS[value] || value}
                  </option>
                ))}
              </select>
              {source.nextRunAt ? (
                <span className="cp-help">Next run {formatDate(source.nextRunAt, { dateStyle: 'medium', timeStyle: 'short' })}</span>
              ) : null}
            </div>

            <label className="cp-checkbox">
              <input
                type="checkbox"
                checked={source.isPaused}
                onChange={(event) =>
                  patch({ isPaused: event.target.checked }, event.target.checked ? 'Source paused.' : 'Source resumed.')
                }
              />
              <span>Pause this source</span>
            </label>

            <hr />

            <div className="cp-subdued" style={{ fontSize: 12.5 }}>
              <div>Last run: {formatRelative(source.lastRunAt)}</div>
              <div>Sheet last edited: {formatRelative(source.lastModifiedAt)}</div>
            </div>
          </Card>
        </div>

        <div className="col-12 col-lg-8">
          <Card title="Safety settings">
            <p className="cp-subdued">
              CatalogPilot never deletes products, collections or variants. These settings control the
              remaining ways a sync can overwrite what is already in your store.
            </p>

            <label className="cp-checkbox mb-3">
              <input
                type="checkbox"
                checked={source.settings.allowBlankOverwrite}
                onChange={(event) =>
                  patch({ allowBlankOverwrite: event.target.checked }, 'Setting saved.')
                }
              />
              <span>
                Allow blank values to overwrite
                <span className="cp-help">
                  Off by default. When off, an empty cell leaves the Shopify value untouched instead of
                  clearing it.
                </span>
              </span>
            </label>

            <label className="cp-checkbox mb-3">
              <input
                type="checkbox"
                checked={source.settings.allowStatusChange}
                onChange={(event) => patch({ allowStatusChange: event.target.checked }, 'Setting saved.')}
              />
              <span>
                Allow this source to change product status
                <span className="cp-help">
                  Controls whether inventory rules may draft or activate products.
                </span>
              </span>
            </label>

            <label className="cp-checkbox">
              <input
                type="checkbox"
                checked={source.settings.allowImageUpdate}
                onChange={(event) => patch({ allowImageUpdate: event.target.checked }, 'Setting saved.')}
              />
              <span>
                Add images from this sheet
                <span className="cp-help">Images are added, never removed.</span>
              </span>
            </label>
          </Card>
        </div>
      </div>

      <Card
        title="Worksheet"
        actions={
          source.selectedWorksheet ? (
            <Badge tone="info">{source.selectedWorksheet.title}</Badge>
          ) : (
            <StatusBadge status="DRAFT" />
          )
        }
      >
        <div className="row g-2">
          {source.worksheets.map((worksheet) => (
            <div key={worksheet.sheetId} className="col-12 col-md-4">
              <button
                type="button"
                className="cp-source-card"
                aria-pressed={worksheet.isSelected}
                onClick={async () => {
                  try {
                    await api.put(`/api/sources/${id}/worksheet`, {
                      sheetId: worksheet.sheetId,
                      title: worksheet.title,
                      headerRow: 1,
                    });
                    toast.success(`Now reading “${worksheet.title}”.`);
                    refresh();
                    mappingsApi.refresh();
                  } catch (caught) {
                    toast.error(caught.message);
                  }
                }}
              >
                <span style={{ fontWeight: 600 }}>{worksheet.title}</span>
                <span className="cp-subdued" style={{ fontSize: 12.5 }}>
                  {formatNumber(worksheet.rowCount)} rows
                </span>
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card
        title="Column mapping"
        padded={false}
        footer={
          <div className="cp-spread">
            <span className="cp-subdued" style={{ fontSize: 12.5 }}>
              Each Shopify field can be filled by one column.
            </span>
            <button
              type="button"
              className="cp-btn cp-btn-primary"
              onClick={saveMappings}
              disabled={saving || !mappings}
            >
              {saving ? 'Saving…' : 'Save mapping'}
            </button>
          </div>
        }
      >
        {!mappings ? (
          <div className="cp-card-body">
            <Skeleton height={140} />
          </div>
        ) : (
          <MappingTable
            mappings={mappings}
            availableFields={mappingsApi.data?.availableFields || []}
            headers={source.selectedWorksheet?.headers || []}
            onChange={setMappings}
          />
        )}
      </Card>
    </div>
  );
}
