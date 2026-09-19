'use client';

import { useMemo, useState } from 'react';
import { Badge, Banner } from './ui.jsx';

/**
 * The column mapping review table.
 *
 * Every suggestion shows its confidence and why it was made, and anything the
 * engine is not sure about is surfaced as "Needs review" rather than being
 * quietly applied. A high-risk field (price, SKU, inventory, status) cannot be
 * left unreviewed — the parent blocks the sync until it is confirmed.
 */

const CONFIDENCE_TONE = {
  EXACT: 'success',
  HIGH: 'success',
  MEDIUM: 'warning',
  LOW: 'warning',
  NEEDS_REVIEW: 'critical',
};

const CONFIDENCE_LABEL = {
  EXACT: 'Exact match',
  HIGH: 'High confidence',
  MEDIUM: 'Likely match',
  LOW: 'Low confidence',
  NEEDS_REVIEW: 'Needs review',
};

export function MappingTable({ mappings, availableFields, sample = [], headers = [], onChange }) {
  const [showOnlyReview, setShowOnlyReview] = useState(false);

  const fieldsByGroup = useMemo(() => {
    const groups = new Map();
    for (const field of availableFields) {
      if (!groups.has(field.group)) groups.set(field.group, []);
      groups.get(field.group).push(field);
    }
    return groups;
  }, [availableFields]);

  const usedFields = useMemo(
    () => new Set(mappings.filter((m) => m.targetField && !m.isIgnored).map((m) => m.targetField)),
    [mappings]
  );

  const sampleFor = (sourceColumn) => {
    const index = headers.indexOf(sourceColumn);
    if (index < 0) return null;
    const values = sample.map((row) => row[index]).filter((v) => v !== '' && v != null);
    return values[0] ?? null;
  };

  const update = (sourceColumn, patch) => {
    onChange(
      mappings.map((mapping) =>
        mapping.sourceColumn === sourceColumn ? { ...mapping, ...patch } : mapping
      )
    );
  };

  const needsReviewCount = mappings.filter(
    (m) => m.targetField && !m.isIgnored && !m.isConfirmed && (m.confidence === 'NEEDS_REVIEW' || m.confidence === 'LOW')
  ).length;

  const visible = showOnlyReview
    ? mappings.filter((m) => !m.isConfirmed && (m.requiresReview || m.confidence === 'NEEDS_REVIEW' || m.confidence === 'LOW'))
    : mappings;

  return (
    <div>
      <div className="cp-spread px-4 py-3" style={{ borderBottom: '1px solid var(--cp-border)' }}>
        <div className="cp-inline">
          <Badge tone={needsReviewCount ? 'warning' : 'success'}>
            {needsReviewCount ? `${needsReviewCount} to review` : 'All columns reviewed'}
          </Badge>
          <span className="cp-subdued" style={{ fontSize: 12.5 }}>
            {mappings.filter((m) => m.targetField && !m.isIgnored).length} of {mappings.length} columns mapped
          </span>
        </div>
        <label className="cp-checkbox mb-0" style={{ fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showOnlyReview}
            onChange={(event) => setShowOnlyReview(event.target.checked)}
          />
          Show only what needs review
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="cp-card-body">
          <Banner tone="success">Every column has been reviewed.</Banner>
        </div>
      ) : (
        <div role="table" aria-label="Column mappings">
          <div className="cp-mapping-row" role="row" style={{ background: 'var(--cp-surface-sunken)' }}>
            <span role="columnheader" className="cp-nav-label p-0">
              Supplier column
            </span>
            <span className="cp-mapping-arrow" aria-hidden="true" />
            <span role="columnheader" className="cp-nav-label p-0">
              Shopify field
            </span>
            <span role="columnheader" className="cp-nav-label p-0">
              Confidence
            </span>
          </div>

          {visible.map((mapping) => {
            const example = sampleFor(mapping.sourceColumn);
            const percent = Math.round((mapping.score || 0) * 100);
            const tone = CONFIDENCE_TONE[mapping.confidence] || 'default';

            return (
              <div className="cp-mapping-row" role="row" key={mapping.sourceColumn}>
                <div role="cell" style={{ minWidth: 0 }}>
                  <div className="cp-truncate" style={{ fontWeight: 550 }}>
                    {mapping.sourceColumn}
                  </div>
                  {example != null ? (
                    <div className="cp-subdued cp-truncate cp-mono" title={String(example)}>
                      {String(example)}
                    </div>
                  ) : (
                    <div className="cp-subdued" style={{ fontSize: 12 }}>
                      No sample data
                    </div>
                  )}
                </div>

                <div role="cell" className="cp-mapping-arrow cp-subdued text-center" aria-hidden="true">
                  →
                </div>

                <div role="cell">
                  <label className="cp-visually-hidden" htmlFor={`map-${mapping.sourceColumn}`}>
                    Shopify field for {mapping.sourceColumn}
                  </label>
                  <select
                    id={`map-${mapping.sourceColumn}`}
                    className="cp-select"
                    value={mapping.isIgnored ? '__ignore__' : mapping.targetField || ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === '__ignore__') {
                        update(mapping.sourceColumn, { isIgnored: true, targetField: null, isConfirmed: true });
                      } else if (value === '') {
                        update(mapping.sourceColumn, { isIgnored: false, targetField: null, isConfirmed: false });
                      } else {
                        update(mapping.sourceColumn, {
                          isIgnored: false,
                          targetField: value,
                          isConfirmed: true,
                          confidence: 'EXACT',
                          score: 1,
                        });
                      }
                    }}
                  >
                    <option value="">Not mapped</option>
                    <option value="__ignore__">Ignore this column</option>
                    {[...fieldsByGroup.entries()].map(([group, fields]) => (
                      <optgroup key={group} label={group}>
                        {fields.map((field) => (
                          <option
                            key={field.key}
                            value={field.key}
                            disabled={usedFields.has(field.key) && field.key !== mapping.targetField}
                          >
                            {field.label}
                            {field.required ? ' (required)' : ''}
                            {usedFields.has(field.key) && field.key !== mapping.targetField ? ' — already used' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div role="cell">
                  {mapping.isIgnored ? (
                    <Badge>Ignored</Badge>
                  ) : mapping.isConfirmed ? (
                    <Badge tone="success">Confirmed</Badge>
                  ) : mapping.targetField ? (
                    <div>
                      <Badge tone={tone}>
                        {percent}% · {CONFIDENCE_LABEL[mapping.confidence]}
                      </Badge>
                      <div className="cp-confidence">
                        <div
                          className="cp-confidence-fill"
                          style={{ width: `${percent}%`, background: `var(--cp-${tone === 'default' ? 'border-strong' : tone})` }}
                        />
                      </div>
                      <button
                        type="button"
                        className="cp-btn cp-btn-plain cp-btn-sm mt-1"
                        onClick={() => update(mapping.sourceColumn, { isConfirmed: true })}
                      >
                        Looks right
                      </button>
                    </div>
                  ) : (
                    <Badge tone="critical">Needs review</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
