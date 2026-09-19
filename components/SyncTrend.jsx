'use client';

/**
 * 30-day activity chart, drawn as inline SVG.
 *
 * A dependency-free chart keeps the embedded bundle small, and stacked bars
 * read better than a line here: the merchant cares about the mix of created /
 * updated / failed on a given day, not a smooth curve.
 */
export function SyncTrend({ data = [] }) {
  const points = data.length ? data : [];
  const max = Math.max(1, ...points.map((d) => d.created + d.updated + d.failed));

  if (points.every((d) => d.created + d.updated + d.failed === 0)) {
    return (
      <p className="cp-subdued mb-0" style={{ fontSize: 13 }}>
        No sync activity in the last 30 days.
      </p>
    );
  }

  const width = 100;
  const height = 34;
  const gap = 0.6;
  const barWidth = width / points.length - gap;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height: 130 }}
      role="img"
      aria-label={`Sync activity over the last 30 days. ${points.reduce((a, d) => a + d.created, 0)} products created, ${points.reduce((a, d) => a + d.updated, 0)} updated, ${points.reduce((a, d) => a + d.failed, 0)} failed.`}
    >
      {points.map((day, index) => {
        const x = index * (barWidth + gap);
        const scale = (value) => (value / max) * height;

        const failedHeight = scale(day.failed);
        const updatedHeight = scale(day.updated);
        const createdHeight = scale(day.created);

        let y = height;
        const segments = [
          { value: failedHeight, color: 'var(--cp-critical)' },
          { value: updatedHeight, color: 'var(--cp-info)' },
          { value: createdHeight, color: 'var(--cp-success)' },
        ];

        return (
          <g key={day.date}>
            {segments.map((segment, segmentIndex) => {
              if (segment.value <= 0) return null;
              y -= segment.value;
              return (
                <rect
                  key={segmentIndex}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={segment.value}
                  fill={segment.color}
                  rx="0.4"
                />
              );
            })}
            <title>
              {day.date}: {day.created} created, {day.updated} updated, {day.failed} failed
            </title>
          </g>
        );
      })}
    </svg>
  );
}
