'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '../../../../lib/use-api.js';
import { api, formatNumber, formatRelative } from '../../../../lib/client-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import {
  Card,
  Banner,
  EmptyState,
  SkeletonTable,
  Badge,
  Pagination,
  PageHeader,
  Skeleton,
} from '../../../../components/ui.jsx';

/**
 * The error center.
 *
 * Every row leads with what the merchant can do about it. Errors a retry
 * cannot fix (a duplicate SKU, a value Shopify rejected) are labelled so the
 * merchant is not sent round a loop that will fail identically.
 */

const KIND_LABELS = {
  VALIDATION: 'Data problem',
  MAPPING: 'Mapping',
  IMAGE: 'Image',
  RATE_LIMIT: 'Rate limit',
  SHOPIFY_API: 'Shopify',
  GOOGLE_API: 'Google',
  PERMISSION: 'Permission',
  PLAN_LIMIT: 'Plan limit',
  UNKNOWN: 'Unexpected',
};

export default function ErrorsPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <ErrorCenter />
    </Suspense>
  );
}

function ErrorCenter() {
  const params = useSearchParams();
  const jobId = params.get('jobId');
  const toast = useToast();
  const confirm = useConfirm();

  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [working, setWorking] = useState(false);

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (jobId) query.set('jobId', jobId);
  const { data, loading, error, refresh } = useApi(`/api/errors?${query}`);

  const errors = data?.errors || [];
  const retryableSelected = errors.filter((e) => selected.includes(e.id) && e.isRetryable);

  const toggle = (id) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
    );
  };

  const retry = async (mode) => {
    setWorking(true);
    try {
      const result = await api.post('/api/errors/retry', {
        mode,
        errorIds: mode === 'selected' ? selected : undefined,
        syncJobId: jobId || undefined,
      });

      if (result.requeued === 0) {
        toast.error(
          result.skipped > 0
            ? 'Those errors cannot be fixed by retrying. Correct the source data first.'
            : 'There was nothing to retry.'
        );
      } else {
        toast.success(
          `Retrying ${formatNumber(result.requeued)} row${result.requeued === 1 ? '' : 's'}.` +
            (result.skipped ? ` ${result.skipped} need a data fix first.` : '')
        );
      }
      setSelected([]);
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    } finally {
      setWorking(false);
    }
  };

  const ignore = async () => {
    const ok = await confirm({
      title: 'Ignore these errors?',
      body: `${selected.length} error${selected.length === 1 ? '' : 's'} will be hidden from this list. The rows stay unsynced.`,
      confirmLabel: 'Ignore',
    });
    if (!ok) return;

    setWorking(true);
    try {
      await api.post('/api/errors/ignore', { errorIds: selected });
      toast.success('Errors ignored.');
      setSelected([]);
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="cp-stack">
      <PageHeader
        title="Error center"
        description="Rows that need your attention, what went wrong, and how to fix them."
        actions={
          <div className="cp-inline">
            <button
              type="button"
              className="cp-btn"
              onClick={() => retry('compatible')}
              disabled={working || errors.length === 0}
            >
              Retry everything retryable
            </button>
            <button
              type="button"
              className="cp-btn cp-btn-primary"
              onClick={() => retry('selected')}
              disabled={working || retryableSelected.length === 0}
            >
              Retry selected ({retryableSelected.length})
            </button>
          </div>
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      {selected.length > 0 ? (
        <Banner
          tone="info"
          action={
            <button type="button" className="cp-btn cp-btn-sm" onClick={ignore} disabled={working}>
              Ignore selected
            </button>
          }
        >
          {selected.length} selected.
          {selected.length > retryableSelected.length
            ? ` ${selected.length - retryableSelected.length} of them need a data fix before a retry will help.`
            : ''}
        </Banner>
      ) : null}

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={4} columns={4} />
        ) : errors.length === 0 ? (
          <EmptyState
            icon="✓"
            title="Nothing needs attention"
            description="Every row from your recent syncs went through cleanly. Anything that fails in future will appear here with a suggested fix."
          />
        ) : (
          <>
            <div className="cp-table-wrap">
              <table className="cp-table">
                <caption className="cp-visually-hidden">Errors needing attention</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 36 }}>
                      <span className="cp-visually-hidden">Select</span>
                    </th>
                    <th scope="col">Product</th>
                    <th scope="col">What went wrong</th>
                    <th scope="col">Type</th>
                    <th scope="col">
                      <span className="cp-visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {errors.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.includes(item.id)}
                          onChange={() => toggle(item.id)}
                          aria-label={`Select error for ${item.productTitle || item.sku || `row ${item.rowNumber}`}`}
                        />
                      </td>

                      <td style={{ maxWidth: 220 }}>
                        <div className="cp-truncate" style={{ fontWeight: 550 }}>
                          {item.productTitle || 'Unnamed product'}
                        </div>
                        <div className="cp-subdued cp-mono" style={{ fontSize: 12 }}>
                          {item.sku ? `SKU ${item.sku}` : ''}
                          {item.rowNumber ? ` · row ${item.rowNumber}` : ''}
                        </div>
                      </td>

                      <td style={{ maxWidth: 420 }}>
                        <div style={{ fontWeight: 550 }}>{item.message}</div>
                        {item.suggestion ? (
                          <div className="cp-subdued" style={{ fontSize: 12.5 }}>
                            {item.suggestion}
                          </div>
                        ) : null}
                        <div className="cp-subdued" style={{ fontSize: 12 }}>
                          {formatRelative(item.createdAt)}
                          {item.retryCount > 0 ? ` · retried ${item.retryCount}×` : ''}
                        </div>
                      </td>

                      <td>
                        <Badge tone={item.isRetryable ? 'warning' : 'critical'}>
                          {KIND_LABELS[item.kind] || item.kind}
                        </Badge>
                        {!item.isRetryable ? (
                          <div className="cp-subdued mt-1" style={{ fontSize: 11.5 }}>
                            Needs a data fix
                          </div>
                        ) : null}
                      </td>

                      <td>
                        <div className="cp-inline">
                          <button
                            type="button"
                            className="cp-btn cp-btn-sm"
                            disabled={!item.isRetryable || working}
                            title={item.isRetryable ? undefined : 'Fix the source data first'}
                            onClick={async () => {
                              setSelected([item.id]);
                              await retry('selected');
                            }}
                          >
                            Retry
                          </button>
                          {item.source?.spreadsheetId ? (
                            <a
                              className="cp-btn cp-btn-sm"
                              href={`https://docs.google.com/spreadsheets/d/${item.source.spreadsheetId}/edit${item.rowNumber ? `#gid=0&range=A${item.rowNumber}` : ''}`}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              Open row
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cp-card-footer">
              <Pagination
                page={data.pagination.page}
                pageSize={data.pagination.pageSize}
                total={data.pagination.total}
                onChange={setPage}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
