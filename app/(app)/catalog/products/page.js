'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '../../../../lib/use-api.js';
import { formatMoney, formatRelative } from '../../../../lib/client-api.js';
import {
  Card,
  Banner,
  EmptyState,
  SkeletonTable,
  Badge,
  StatusBadge,
  PageHeader,
  Skeleton,
} from '../../../../components/ui.jsx';

export default function ProductsPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <ProductsScreen />
    </Suspense>
  );
}

function ProductsScreen() {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [cursors, setCursors] = useState([null]);
  const [pageIndex, setPageIndex] = useState(0);

  const after = cursors[pageIndex];
  const query = new URLSearchParams();
  if (after) query.set('after', after);
  if (search) query.set('q', search);

  const { data, loading, error } = useApi(`/api/catalog/products?${query}`);
  const products = data?.products || [];

  return (
    <div className="cp-stack">
      <PageHeader
        title="Products"
        description="Your Shopify catalog, showing which products CatalogPilot keeps in sync."
        actions={
          <input
            type="search"
            className="cp-input"
            style={{ width: 240 }}
            placeholder="Search title or SKU"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCursors([null]);
              setPageIndex(0);
            }}
            aria-label="Search products"
          />
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={6} columns={5} />
        ) : products.length === 0 ? (
          <EmptyState
            icon="◻"
            title={search ? 'No products matched' : 'No products in your store yet'}
            description={
              search
                ? `Nothing in your Shopify catalog matched “${search}”.`
                : 'Once you run your first sync, the products CatalogPilot creates will appear here.'
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
                <caption className="cp-visually-hidden">Shopify products</caption>
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col">SKU</th>
                    <th scope="col" className="cp-table-numeric">
                      Price
                    </th>
                    <th scope="col" className="cp-table-numeric">
                      Inventory
                    </th>
                    <th scope="col">Status</th>
                    <th scope="col">Managed</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td style={{ maxWidth: 300 }}>
                        <div className="cp-inline">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt=""
                              width={32}
                              height={32}
                              style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                            />
                          ) : (
                            <span
                              aria-hidden="true"
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 4,
                                background: 'var(--cp-surface-sunken)',
                                border: '1px solid var(--cp-border)',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          <span style={{ minWidth: 0 }}>
                            <span className="cp-truncate d-block" style={{ fontWeight: 550 }}>
                              {product.title}
                            </span>
                            <span className="cp-subdued" style={{ fontSize: 12 }}>
                              {product.vendor || '—'}
                              {product.productType ? ` · ${product.productType}` : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td className="cp-mono">{product.sku || '—'}</td>
                      <td className="cp-table-numeric">{formatMoney(product.price)}</td>
                      <td className="cp-table-numeric">{product.inventory ?? '—'}</td>
                      <td>
                        <StatusBadge status={product.status} />
                      </td>
                      <td>
                        {product.managed ? (
                          <>
                            <Badge tone="success">CatalogPilot</Badge>
                            <div className="cp-subdued" style={{ fontSize: 11.5 }}>
                              {formatRelative(product.lastSyncedAt)}
                            </div>
                          </>
                        ) : (
                          <Badge>Not managed</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="cp-card-footer">
              <div className="cp-spread">
                <span className="cp-subdued" style={{ fontSize: 12.5 }}>
                  Page {pageIndex + 1}
                </span>
                <div className="cp-inline">
                  <button
                    type="button"
                    className="cp-btn cp-btn-sm"
                    disabled={pageIndex === 0}
                    onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    className="cp-btn cp-btn-sm"
                    disabled={!data?.pageInfo?.hasNextPage}
                    onClick={() => {
                      const next = data.pageInfo.endCursor;
                      setCursors((current) => {
                        const copy = current.slice(0, pageIndex + 1);
                        copy.push(next);
                        return copy;
                      });
                      setPageIndex((index) => index + 1);
                    }}
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
