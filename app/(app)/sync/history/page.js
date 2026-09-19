'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '../../../../lib/use-api.js';
import { formatNumber, formatDate, formatDuration } from '../../../../lib/client-api.js';
import {
  Card,
  Banner,
  EmptyState,
  SkeletonTable,
  StatusBadge,
  Pagination,
  PageHeader,
  ProgressBar,
  Skeleton,
} from '../../../../components/ui.jsx';

export default function HistoryPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <HistoryScreen />
    </Suspense>
  );
}

function HistoryScreen() {
  const params = useSearchParams();
  const runningJobId = params.get('jobId');
  const [page, setPage] = useState(1);

  const { data, loading, error } = useApi(`/api/history?page=${page}&pageSize=25`);
  // Poll the job that was just started so the merchant sees it finish.
  const live = useApi(runningJobId ? `/api/jobs/${runningJobId}` : null, {
    enabled: Boolean(runningJobId),
    pollMs: 2000,
  });

  const history = data?.history || [];
  const job = live.data?.job;
  const isRunning = job && ['QUEUED', 'RUNNING'].includes(job.status);

  return (
    <div className="cp-stack">
      <PageHeader
        title="Sync history"
        description="Every run, what it changed, and how long it took."
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      {job ? (
        <Card title={isRunning ? 'Sync in progress' : 'Latest sync'}>
          {isRunning ? (
            <div className="cp-stack-sm">
              <ProgressBar
                value={job.processed}
                max={job.total || 1}
                label={`${formatNumber(job.processed)} / ${formatNumber(job.total)} products · ${job.source?.name || ''}`}
              />
              <p className="cp-subdued mb-0" style={{ fontSize: 12.5 }}>
                {formatNumber(job.created)} created · {formatNumber(job.updated)} updated
                {job.failed > 0 ? ` · ${formatNumber(job.failed)} failed` : ''}
              </p>
            </div>
          ) : (
            <div className="cp-inline">
              <StatusBadge status={job.status} />
              <span className="cp-subdued">
                {formatNumber(job.created)} created, {formatNumber(job.updated)} updated
                {job.failed > 0 ? `, ${formatNumber(job.failed)} need attention` : ''}
              </span>
              {job.failed > 0 ? (
                <Link href="/sync/errors" className="cp-btn cp-btn-sm">
                  Review errors
                </Link>
              ) : null}
            </div>
          )}
        </Card>
      ) : null}

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={5} columns={6} />
        ) : history.length === 0 ? (
          <EmptyState
            icon="◷"
            title="No syncs have run yet"
            description="Once you approve your first preview, every run will be recorded here with its full result."
            action={
              <Link href="/sync/preview" className="cp-btn cp-btn-primary">
                Preview a sync
              </Link>
            }
          />
        ) : (
          <>
            <div className="cp-table-wrap">
              <table className="cp-table">
                <caption className="cp-visually-hidden">Sync history</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="cp-table-numeric">
                      Scanned
                    </th>
                    <th scope="col" className="cp-table-numeric">
                      Created
                    </th>
                    <th scope="col" className="cp-table-numeric">
                      Updated
                    </th>
                    <th scope="col" className="cp-table-numeric">
                      Unchanged
                    </th>
                    <th scope="col" className="cp-table-numeric">
                      Failed
                    </th>
                    <th scope="col">Duration</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((run) => (
                    <tr key={run.id}>
                      <td>
                        {formatDate(run.startedAt, { dateStyle: 'medium' })}
                        <div className="cp-subdued" style={{ fontSize: 12 }}>
                          {formatDate(run.startedAt, { timeStyle: 'short' })} · {run.triggeredBy}
                        </div>
                      </td>
                      <td>{run.source?.name || '—'}</td>
                      <td className="cp-table-numeric">{formatNumber(run.scanned)}</td>
                      <td className="cp-table-numeric">{formatNumber(run.created)}</td>
                      <td className="cp-table-numeric">{formatNumber(run.updated)}</td>
                      <td className="cp-table-numeric cp-subdued">{formatNumber(run.unchanged)}</td>
                      <td className="cp-table-numeric">
                        {run.failed > 0 ? (
                          <Link href={`/sync/errors?jobId=${run.jobId}`}>{formatNumber(run.failed)}</Link>
                        ) : (
                          <span className="cp-subdued">0</span>
                        )}
                      </td>
                      <td className="cp-subdued">{formatDuration(run.durationMs)}</td>
                      <td>
                        <StatusBadge status={run.status} />
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
