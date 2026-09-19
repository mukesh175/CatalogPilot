'use client';

import Link from 'next/link';

/** Shared presentational primitives. No business logic lives here. */

export function Card({ title, actions, children, footer, padded = true, className = '' }) {
  return (
    <section className={`cp-card ${className}`}>
      {title || actions ? (
        <div className="cp-card-header">
          {typeof title === 'string' ? <h2 className="cp-h2">{title}</h2> : title}
          {actions ? <div className="cp-inline">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? 'cp-card-body' : ''}>{children}</div>
      {footer ? <div className="cp-card-footer">{footer}</div> : null}
    </section>
  );
}

export function MetricCard({ label, value, hint, tone }) {
  return (
    <div className="cp-card cp-metric-card">
      <span className="cp-metric-label">{label}</span>
      <span className="cp-metric" style={tone ? { color: `var(--cp-${tone})` } : undefined}>
        {value}
      </span>
      {hint ? <span className="cp-subdued" style={{ fontSize: 12.5 }}>{hint}</span> : null}
    </div>
  );
}

export function Badge({ tone = 'default', children }) {
  const className = tone === 'default' ? 'cp-badge' : `cp-badge cp-badge-${tone}`;
  return <span className={className}>{children}</span>;
}

export function StatusBadge({ status }) {
  const map = {
    ACTIVE: ['success', 'Active'],
    DRAFT: ['warning', 'Draft'],
    ARCHIVED: ['default', 'Archived'],
    READY: ['success', 'Ready'],
    ERROR: ['critical', 'Error'],
    DISCONNECTED: ['critical', 'Disconnected'],
    QUEUED: ['info', 'Queued'],
    RUNNING: ['info', 'Running'],
    COMPLETED: ['success', 'Completed'],
    COMPLETED_WITH_ERRORS: ['warning', 'Completed with errors'],
    FAILED: ['critical', 'Failed'],
    CANCELLED: ['default', 'Cancelled'],
    CREATE: ['success', 'New'],
    UPDATE: ['info', 'Update'],
    UNCHANGED: ['default', 'No change'],
    SKIP: ['default', 'Skipped'],
  };
  const [tone, label] = map[status] || ['default', status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Banner({ tone = 'info', title, children, action }) {
  return (
    <div className={`cp-banner cp-banner-${tone}`} role={tone === 'critical' ? 'alert' : 'status'}>
      <div className="flex-grow-1">
        {title ? <strong className="d-block">{title}</strong> : null}
        {children}
      </div>
      {action ? <div className="flex-shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({ icon = '◇', title, description, action, secondaryAction }) {
  return (
    <div className="cp-empty">
      <div className="cp-empty-icon" aria-hidden="true">
        {icon}
      </div>
      <h2 className="cp-h2 mb-2">{title}</h2>
      <p className="cp-subdued mb-4">{description}</p>
      <div className="cp-inline justify-content-center">
        {action}
        {secondaryAction}
      </div>
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%', className = '' }) {
  return <div className={`cp-skeleton ${className}`} style={{ height, width }} aria-hidden="true" />;
}

export function SkeletonTable({ rows = 5, columns = 4 }) {
  return (
    <div className="cp-card-body" aria-busy="true" aria-live="polite">
      <span className="cp-visually-hidden">Loading</span>
      <div className="cp-stack-sm">
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <div key={rowIndex} className="d-flex gap-3">
            {Array.from({ length: columns }).map((__, columnIndex) => (
              <Skeleton key={columnIndex} height={14} width={columnIndex === 0 ? '30%' : '20%'} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgressBar({ value, max = 100, tone, label }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      {label ? (
        <div className="cp-spread mb-1" style={{ fontSize: 12.5 }}>
          <span className="cp-subdued">{label}</span>
          <span className="cp-subdued">{percent}%</span>
        </div>
      ) : null}
      <div
        className="cp-progress"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
      >
        <div
          className={`cp-progress-bar${tone === 'success' ? ' cp-progress-bar-success' : ''}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions, backHref, backLabel }) {
  return (
    <header className="cp-page-header">
      <div>
        {backHref ? (
          <Link href={backHref} className="cp-btn cp-btn-plain cp-btn-sm mb-2 d-inline-flex">
            ← {backLabel || 'Back'}
          </Link>
        ) : null}
        <h1>{title}</h1>
        {description ? <p className="cp-subdued mb-0 mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="cp-inline">{actions}</div> : null}
    </header>
  );
}

export function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="cp-spread">
      <span className="cp-subdued" style={{ fontSize: 12.5 }}>
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="cp-inline">
        <button
          type="button"
          className="cp-btn cp-btn-sm"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <span className="cp-subdued" style={{ fontSize: 12.5 }}>
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="cp-btn cp-btn-sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Renders the "why did this change" block shown throughout the product. */
export function Explanation({ explanation }) {
  if (!explanation) return null;
  return (
    <div className="cp-explain">
      <div className="cp-inline mb-2">
        <Badge tone="info">{explanation.rule}</Badge>
        {explanation.condition ? (
          <span className="cp-subdued" style={{ fontSize: 12 }}>
            {explanation.condition}
          </span>
        ) : null}
      </div>
      {(explanation.steps || []).map((step, index) => (
        <div key={index} className="cp-explain-step">
          <span aria-hidden="true">→</span>
          <span>{step}</span>
        </div>
      ))}
      {explanation.result ? (
        <div className="mt-2" style={{ fontWeight: 600 }}>
          Final: {explanation.result}
        </div>
      ) : null}
    </div>
  );
}
