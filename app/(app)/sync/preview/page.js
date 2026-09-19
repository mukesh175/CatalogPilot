'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, formatNumber } from '../../../../lib/client-api.js';
import { useApi } from '../../../../lib/use-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import { PreviewTable } from '../../../../components/PreviewTable.jsx';
import {
  Card,
  Banner,
  EmptyState,
  Skeleton,
  ProgressBar,
  PageHeader,
  StatusBadge,
} from '../../../../components/ui.jsx';

export default function PreviewPage() {
  return (
    <Suspense fallback={<Skeleton height={300} />}>
      <PreviewScreen />
    </Suspense>
  );
}

function PreviewScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();

  const jobIdParam = params.get('jobId');
  const [jobId, setJobId] = useState(jobIdParam);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(Boolean(jobIdParam));
  const [applying, setApplying] = useState(false);

  const sources = useApi('/api/sources');
  const jobs = useApi('/api/jobs');

  // Fall back to the most recent preview so the page is useful when opened
  // straight from the sidebar.
  useEffect(() => {
    if (jobId || !jobs.data) return;
    const latest = jobs.data.jobs.find((job) => job.kind === 'PREVIEW');
    if (latest) setJobId(latest.id);
  }, [jobs.data, jobId]);

  useEffect(() => {
    if (!jobId) return undefined;
    let cancelled = false;
    let timer;

    const load = async () => {
      try {
        const query = new URLSearchParams({ action: filter, page: String(page), pageSize: '25' });
        if (search) query.set('search', search);
        const result = await api.get(`/api/jobs/${jobId}/items?${query}`);
        if (cancelled) return;
        setData(result);
        setLoading(false);
        if (result.job.status === 'QUEUED' || result.job.status === 'RUNNING') {
          timer = setTimeout(load, 2000);
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          toast.error(error.message);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, filter, page, search, toast]);

  const startPreview = async (sourceId) => {
    try {
      const result = await api.post('/api/jobs', { dataSourceId: sourceId, kind: 'PREVIEW' });
      setJobId(result.job.id);
      setData(null);
      setLoading(true);
      router.replace(`/sync/preview?jobId=${result.job.id}`);
    } catch (error) {
      if (error.code === 'mappings_incomplete') {
        toast.error('Finish mapping this source before previewing a sync.');
      } else if (error.code === 'job_in_progress') {
        setJobId(error.details?.jobId);
        toast.error(error.message);
      } else {
        toast.error(error.message);
      }
    }
  };

  const apply = async () => {
    const create = data?.summary?.CREATE || 0;
    const update = data?.summary?.UPDATE || 0;

    const ok = await confirm({
      title: 'Apply these changes to your store?',
      body: `${formatNumber(create)} products will be created and ${formatNumber(update)} updated. Nothing will be deleted.`,
      confirmLabel: 'Sync to Shopify',
    });
    if (!ok) return;

    setApplying(true);
    try {
      const result = await api.post(`/api/jobs/${jobId}/apply`);
      toast.success('Sync started.');
      router.push(`/sync/history?jobId=${result.job.id}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setApplying(false);
    }
  };

  const readySources = (sources.data?.sources || []).filter((source) => source.status === 'READY');
  const building = data?.job?.status === 'QUEUED' || data?.job?.status === 'RUNNING';
  const applicable = (data?.summary?.CREATE || 0) + (data?.summary?.UPDATE || 0);
  const isPreviewJob = data?.job?.kind === 'PREVIEW';

  if (!jobId && !sources.loading && readySources.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="◎"
          title="Nothing to preview yet"
          description="Connect a supplier sheet and finish its column mapping. Then you can preview exactly what a sync would change before anything touches your store."
          action={
            <Link href="/sources" className="cp-btn cp-btn-primary">
              Go to sources
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="cp-stack">
      <PageHeader
        title="Sync preview"
        description="Every change CatalogPilot would make, and the rule behind it — before anything is applied."
        actions={
          <div className="cp-inline">
            <label className="cp-visually-hidden" htmlFor="preview-source">
              Choose a source to preview
            </label>
            <select
              id="preview-source"
              className="cp-select"
              style={{ width: 'auto' }}
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) startPreview(event.target.value);
              }}
            >
              <option value="">Build a new preview…</option>
              {readySources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>

            {isPreviewJob ? (
              <button
                type="button"
                className="cp-btn cp-btn-primary"
                onClick={apply}
                disabled={applying || building || applicable === 0}
              >
                {applying ? 'Starting…' : `Apply ${formatNumber(applicable)} changes`}
              </button>
            ) : null}
          </div>
        }
      />

      {building ? (
        <Card>
          <ProgressBar
            value={data?.pagination?.total || 1}
            max={Math.max(data?.pagination?.total || 1, 1)}
            label="Reading your sheet and comparing it with Shopify"
          />
          <p className="cp-subdued mb-0 mt-2" style={{ fontSize: 12.5 }}>
            Large catalogs take a moment. This page updates on its own.
          </p>
        </Card>
      ) : null}

      {data && !building ? (
        <Banner tone={data.summary.ERROR > 0 ? 'warning' : 'info'}>
          {data.summary.ERROR > 0
            ? `${formatNumber(data.summary.ERROR)} rows need attention and will be skipped. Everything else is ready to apply.`
            : 'Nothing is deleted by a sync. Products, collections and variants are only created or updated.'}
        </Banner>
      ) : null}

      <Card
        title={
          <div className="cp-inline">
            <span className="cp-h2">Planned changes</span>
            {data?.job ? <StatusBadge status={data.job.status} /> : null}
          </div>
        }
        padded={false}
      >
        {!jobId ? (
          <EmptyState
            icon="◎"
            title="Choose a source to preview"
            description="Pick one of your connected sources above and CatalogPilot will show you exactly what would change."
          />
        ) : (
          <PreviewTable
            data={data}
            loading={loading}
            filter={filter}
            onFilterChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
            page={page}
            onPageChange={setPage}
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
          />
        )}
      </Card>
    </div>
  );
}
