'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useApi } from '../../../../lib/use-api.js';
import { api, apiFetch, formatNumber, formatRelative } from '../../../../lib/client-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import { Card, Banner, EmptyState, SkeletonTable, StatusBadge, PageHeader } from '../../../../components/ui.jsx';

/**
 * CSV / Excel sources.
 *
 * Uploading goes through apiFetch directly rather than the JSON helpers,
 * because FormData must be sent without a JSON content-type header.
 */
export default function FileSourcesPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const inputRef = useRef(null);
  const { data, loading, error, refresh } = useApi('/api/sources');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const sources = (data?.sources || []).filter((source) =>
    ['CSV', 'EXCEL', 'CSV_URL'].includes(source.kind)
  );

  const upload = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await apiFetch('/api/sources/files', { method: 'POST', body: form });
      toast.success(`Imported ${formatNumber(result.rowCount)} rows from ${result.source.name}.`);
      refresh();
    } catch (caught) {
      toast.error(
        caught.details?.suggestion ? `${caught.message} ${caught.details.suggestion}` : caught.message
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  /**
   * Removing a source stops future syncs and forgets its mapping. The products
   * it already created in Shopify are deliberately left alone — the merchant
   * deletes those in Shopify if they want them gone.
   */
  const remove = async (source) => {
    const ok = await confirm({
      title: `Delete ${source.name}?`,
      body: 'Its column mapping and uploaded rows are removed, and it will stop syncing. Products already created in your Shopify store are not changed or deleted.',
      confirmLabel: 'Delete source',
      destructive: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/api/sources/${source.id}`);
      toast.success(`${source.name} deleted.`);
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  return (
    <div className="cp-stack">
      <PageHeader
        title="CSV / Excel"
        description="Upload a supplier file directly. Re-upload the same file later to refresh your catalog."
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      <Card title="Upload a supplier file">
        <div
          className="cp-source-card text-center"
          style={{
            alignItems: 'center',
            borderStyle: 'dashed',
            borderColor: dragging ? 'var(--cp-accent)' : undefined,
            padding: 32,
            cursor: 'pointer',
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            upload(event.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              inputRef.current?.click();
            }
          }}
        >
          <span style={{ fontSize: 22 }} aria-hidden="true">
            ⬆
          </span>
          <strong>{uploading ? 'Importing…' : 'Drop a .csv or .xlsx file here'}</strong>
          <span className="cp-subdued" style={{ fontSize: 12.5 }}>
            Up to 20MB and 100,000 rows. The first row must contain your column names.
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xlsm"
          className="cp-visually-hidden"
          onChange={(event) => upload(event.target.files?.[0])}
          aria-label="Choose a CSV or Excel file to upload"
        />
      </Card>

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={2} columns={4} />
        ) : sources.length === 0 ? (
          <EmptyState
            icon="⬡"
            title="No files uploaded yet"
            description="Upload the CSV or Excel file your supplier sends you, and CatalogPilot will map its columns to Shopify fields."
          />
        ) : (
          <div className="cp-table-wrap">
            <table className="cp-table">
              <caption className="cp-visually-hidden">Uploaded file sources</caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Rows</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="cp-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <td style={{ fontWeight: 550 }}>{source.name}</td>
                    <td className="cp-table-numeric">
                      {source.worksheet ? formatNumber(source.worksheet.rowCount) : '—'}
                    </td>
                    <td className="cp-subdued">{formatRelative(source.lastRunAt)}</td>
                    <td>
                      <StatusBadge status={source.status} />
                    </td>
                    <td>
                      <div className="cp-inline">
                        <Link href={`/sources/${source.id}`} className="cp-btn cp-btn-sm">
                          Configure
                        </Link>
                        <button type="button" className="cp-btn cp-btn-sm" onClick={() => remove(source)}>
                          Delete
                        </button>
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
