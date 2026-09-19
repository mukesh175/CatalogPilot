'use client';

import Link from 'next/link';
import { useApi } from '../../../../lib/use-api.js';
import { formatNumber } from '../../../../lib/client-api.js';
import {
  Card,
  Banner,
  EmptyState,
  SkeletonTable,
  Badge,
  PageHeader,
} from '../../../../components/ui.jsx';

export default function CollectionsPage() {
  const { data, loading, error } = useApi('/api/catalog/collections');
  const collections = data?.collections || [];

  return (
    <div className="cp-stack">
      <PageHeader
        title="Collections"
        description="Collections in your store, and which supplier category feeds each one."
        actions={
          <Link href="/automation/collections" className="cp-btn">
            Collection rules
          </Link>
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      <Banner tone="info">
        CatalogPilot only adds products to collections. It never removes a product from a collection or
        deletes one.
      </Banner>

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={5} columns={4} />
        ) : collections.length === 0 ? (
          <EmptyState
            icon="◰"
            title="No collections yet"
            description="Create collections in Shopify, or add a collection rule so CatalogPilot can file products by their supplier category."
            action={
              <Link href="/automation/collections" className="cp-btn cp-btn-primary">
                Add a collection rule
              </Link>
            }
          />
        ) : (
          <div className="cp-table-wrap">
            <table className="cp-table">
              <caption className="cp-visually-hidden">Shopify collections</caption>
              <thead>
                <tr>
                  <th scope="col">Collection</th>
                  <th scope="col" className="cp-table-numeric">
                    Products
                  </th>
                  <th scope="col">Mapped from</th>
                  <th scope="col">Origin</th>
                </tr>
              </thead>
              <tbody>
                {collections.map((collection) => (
                  <tr key={collection.id}>
                    <td style={{ fontWeight: 550 }}>{collection.title}</td>
                    <td className="cp-table-numeric">{formatNumber(collection.productCount)}</td>
                    <td>
                      {collection.mappedFrom ? (
                        <Badge tone="info">{collection.mappedFrom}</Badge>
                      ) : (
                        <span className="cp-subdued">—</span>
                      )}
                    </td>
                    <td>
                      {collection.createdByApp ? (
                        <Badge tone="success">Created by CatalogPilot</Badge>
                      ) : (
                        <Badge>Existing</Badge>
                      )}
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
