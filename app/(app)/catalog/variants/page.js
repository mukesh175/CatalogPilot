'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '../../../../lib/use-api.js';
import { formatRelative } from '../../../../lib/client-api.js';
import {
  Card,
  Banner,
  EmptyState,
  SkeletonTable,
  Pagination,
  PageHeader,
  Skeleton,
} from '../../../../components/ui.jsx';

export default function VariantsPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <VariantsScreen />
    </Suspense>
  );
}

function VariantsScreen() {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [page, setPage] = useState(1);

  const query = new URLSearchParams({ page: String(page), pageSize: '25' });
  if (search) query.set('q', search);

  const { data, loading, error } = useApi(`/api/catalog/variants?${query}`);
  const variants = data?.variants || [];

  return (
    <div className="cp-stack">
      <PageHeader
        title="Variants"
        description="Every variant CatalogPilot keeps linked to a row in your supplier data."
        actions={
          <input
            type="search"
            className="cp-input"
            style={{ width: 240 }}
            placeholder="Search by SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            aria-label="Search variants by SKU"
          />
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={6} columns={4} />
        ) : variants.length === 0 ? (
          <EmptyState
            icon="◫"
            title={search ? 'No variants matched' : 'No variants synced yet'}
            description={
              search
                ? `No managed variant has a SKU matching “${search}”.`
                : 'After your first sync, each variant is linked to its source row so future updates land on the right product.'
            }
            action={
              !search ? (
                <Link href="/sync/preview" className="cp-btn cp-btn-primary">
                  Preview a sync
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <div className="cp-table-wrap">
              <table className="cp-table">
                <caption className="cp-visually-hidden">Managed variants</caption>
                <thead>
                  <tr>
                    <th scope="col">SKU</th>
                    <th scope="col">Product</th>
                    <th scope="col">Source</th>
                    <th scope="col">Last synced</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.map((variant) => (
                    <tr key={variant.id}>
                      <td className="cp-mono" style={{ fontWeight: 550 }}>
                        {variant.sku}
                      </td>
                      <td>{variant.handle || '—'}</td>
                      <td className="cp-subdued">{variant.sourceName || '—'}</td>
                      <td className="cp-subdued">{formatRelative(variant.lastSyncedAt)}</td>
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
