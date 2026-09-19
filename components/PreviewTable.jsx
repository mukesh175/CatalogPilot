'use client';

import { useState } from 'react';
import { StatusBadge, Badge, Explanation, Pagination, SkeletonTable, EmptyState } from './ui.jsx';

/**
 * The sync preview.
 *
 * Each row shows the current Shopify value, the incoming value, and the rule
 * that produced it — the merchant should never have to guess why a price is
 * changing. Rows are paged server-side; the browser holds one page at a time.
 */

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'CREATE', label: 'New' },
  { key: 'UPDATE', label: 'Updated' },
  { key: 'UNCHANGED', label: 'No change' },
  { key: 'ERROR', label: 'Need attention' },
];

export function PreviewTable({ data, loading, filter, onFilterChange, page, onPageChange, search, onSearchChange }) {
  const [expanded, setExpanded] = useState(null);

  const summary = data?.summary || {};
  const items = data?.items || [];
  const pagination = data?.pagination || { page: 1, pageSize: 25, total: 0 };

  return (
    <div>
      <div className="cp-card-body" style={{ paddingBottom: 0 }}>
        <div className="row g-3 mb-4">
          <SummaryTile label="New products" value={summary.CREATE || 0} tone="success" />
          <SummaryTile label="Products updated" value={summary.UPDATE || 0} tone="info" />
          <SummaryTile label="No changes" value={summary.UNCHANGED || 0} />
          <SummaryTile label="Need attention" value={summary.ERROR || 0} tone="critical" />
        </div>

        <div className="cp-spread flex-wrap gap-2 mb-3">
          <div className="cp-inline" role="group" aria-label="Filter preview rows">
            {FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`cp-btn cp-btn-sm${filter === item.key ? ' cp-btn-primary' : ''}`}
                aria-pressed={filter === item.key}
                onClick={() => onFilterChange(item.key)}
              >
                {item.label}
                {item.key !== 'ALL' && summary[item.key] != null ? ` (${summary[item.key].toLocaleString()})` : ''}
              </button>
            ))}
          </div>

          <div style={{ minWidth: 200 }}>
            <label className="cp-visually-hidden" htmlFor="preview-search">
              Search preview rows by SKU or title
            </label>
            <input
              id="preview-search"
              type="search"
              className="cp-input"
              placeholder="Search SKU or title"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="◎"
          title="Nothing matches this filter"
          description="Try a different filter, or clear your search to see every row in this preview."
        />
      ) : (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <caption className="cp-visually-hidden">Planned changes for this sync</caption>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">SKU</th>
                <th scope="col">Change</th>
                <th scope="col">Action</th>
                <th scope="col">
                  <span className="cp-visually-hidden">Details</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const isOpen = expanded === item.id;
                const changes = item.changes || [];
                const primary = changes[0];

                return (
                  <tr key={item.id}>
                    <td style={{ maxWidth: 260 }}>
                      <div className="cp-truncate" style={{ fontWeight: 550 }}>
                        {item.title || `Row ${item.rowNumber}`}
                      </div>
                      <span className="cp-subdued" style={{ fontSize: 12 }}>
                        Row {item.rowNumber}
                      </span>
                      {(item.warnings || []).length > 0 ? (
                        <div className="mt-1">
                          <Badge tone="warning">{item.warnings.length} warning</Badge>
                        </div>
                      ) : null}
                    </td>

                    <td className="cp-mono">{item.sku || '—'}</td>

                    <td style={{ maxWidth: 360 }}>
                      {changes.length === 0 ? (
                        <span className="cp-subdued">No changes</span>
                      ) : (
                        <>
                          <ChangeLine change={primary} />
                          {changes.length > 1 ? (
                            <span className="cp-subdued" style={{ fontSize: 12 }}>
                              +{changes.length - 1} more field{changes.length > 2 ? 's' : ''}
                            </span>
                          ) : null}
                          {isOpen ? (
                            <div className="mt-3 cp-stack-sm">
                              {changes.map((change, index) => (
                                <div key={index}>
                                  <ChangeLine change={change} showLabel />
                                  <Explanation explanation={change.explanation} />
                                </div>
                              ))}
                              {(item.warnings || []).map((warning, index) => (
                                <div key={`w-${index}`} className="cp-banner cp-banner-warning">
                                  {warning.message}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                    </td>

                    <td>
                      <StatusBadge status={item.action} />
                    </td>

                    <td>
                      {changes.length > 0 ? (
                        <button
                          type="button"
                          className="cp-btn cp-btn-sm"
                          aria-expanded={isOpen}
                          onClick={() => setExpanded(isOpen ? null : item.id)}
                        >
                          {isOpen ? 'Hide' : 'Why?'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="cp-card-footer">
        <Pagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          total={pagination.total}
          onChange={onPageChange}
        />
      </div>
    </div>
  );
}

function ChangeLine({ change, showLabel = false }) {
  if (!change) return null;
  const format = (value) => {
    if (value == null) return 'empty';
    if (Array.isArray(value)) return value.join(', ') || 'empty';
    return String(value);
  };

  return (
    <div className="cp-diff">
      {showLabel ? <span className="cp-subdued">{change.label}:</span> : null}
      {change.current != null ? <span className="cp-diff-from">{format(change.current)}</span> : null}
      <span className="cp-diff-arrow" aria-hidden="true">
        →
      </span>
      <span className="cp-diff-to">{format(change.incoming)}</span>
      {!showLabel ? (
        <span className="cp-subdued" style={{ fontSize: 12 }}>
          ({change.label})
        </span>
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value, tone }) {
  return (
    <div className="col-6 col-lg-3">
      <div
        className="cp-card cp-metric-card"
        style={{ boxShadow: 'none', background: 'var(--cp-surface-sunken)' }}
      >
        <span className="cp-metric-label">{label}</span>
        <span className="cp-metric" style={tone ? { color: `var(--cp-${tone})` } : undefined}>
          {Number(value).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
