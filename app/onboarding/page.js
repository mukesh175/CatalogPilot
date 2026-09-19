'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, formatDate, formatNumber } from '../../lib/client-api.js';
import { useToast } from '../../components/AppProviders.jsx';
import { StepIndicator } from '../../components/onboarding/Steps.jsx';
import { MappingTable } from '../../components/MappingTable.jsx';
import { PreviewTable } from '../../components/PreviewTable.jsx';
import { RuleQuickStart } from '../../components/RuleQuickStart.jsx';
import { Card, Banner, EmptyState, Skeleton, ProgressBar, Badge } from '../../components/ui.jsx';

/**
 * The onboarding wizard.
 *
 * Each step is backed by a real API call — connecting the sheet, reading the
 * worksheet, saving mappings, creating rules, building the preview and running
 * the sync all hit the same endpoints the rest of the app uses.
 */
export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="cp-wizard"><Skeleton height={200} /></div>}>
      <OnboardingWizard />
    </Suspense>
  );
}

function OnboardingWizard() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [step, setStep] = useState('welcome');
  const [source, setSource] = useState(null);
  const [worksheets, setWorksheets] = useState([]);
  const [mappingState, setMappingState] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Returning from Google consent lands here with ?google=connected.
  useEffect(() => {
    const googleStatus = params.get('google');
    if (!googleStatus) return;
    if (googleStatus === 'connected') {
      setStep('source');
      toast.success('Google account connected.');
    } else {
      toast.error('Google did not complete the connection. Try again.');
    }
  }, [params, toast]);

  const connectGoogle = async () => {
    setBusy(true);
    try {
      const { url } = await api.get('/api/auth/google/start');
      // Google refuses to render inside the Shopify iframe, so consent has to
      // open at the top level.
      window.open(url, '_top');
    } catch (error) {
      toast.error(error.message);
      setBusy(false);
    }
  };

  const chooseSpreadsheet = async (file) => {
    setBusy(true);
    try {
      const result = await api.post('/api/sources', {
        spreadsheetId: file.id,
        name: file.name,
        url: file.url,
        modifiedAt: file.modifiedAt,
      });
      setSource(result.source);
      setWorksheets(result.worksheets);
      setStep('worksheet');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const chooseWorksheet = async (worksheet) => {
    setBusy(true);
    try {
      const result = await api.put(`/api/sources/${source.id}/worksheet`, {
        sheetId: worksheet.sheetId,
        title: worksheet.title,
        headerRow: 1,
      });
      const fields = await api.get(`/api/sources/${source.id}/mappings`);
      setMappingState({
        mappings: result.suggestions,
        availableFields: fields.availableFields,
        headers: result.headers,
        sample: result.sample,
        rowCount: result.rowCount,
      });
      setStep('mapping');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const saveMappings = async () => {
    setBusy(true);
    try {
      const result = await api.put(`/api/sources/${source.id}/mappings`, {
        mappings: mappingState.mappings.map((m) => ({
          sourceColumn: m.sourceColumn,
          targetField: m.isIgnored ? null : m.targetField,
          confidence: m.confidence,
          score: m.score,
          isConfirmed: m.isConfirmed,
          isIgnored: m.isIgnored,
        })),
      });
      if (!result.validation.ok) {
        toast.error(
          result.validation.missing.length
            ? `Still missing: ${result.validation.missing.map((m) => m.label).join(', ')}`
            : 'Some columns still need review.'
        );
        setMappingState((current) => ({ ...current, mappings: result.mappings }));
        return;
      }
      setStep('rules');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const buildPreview = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.post('/api/jobs', { dataSourceId: source.id, kind: 'PREVIEW' });
      setJobId(result.job.id);
      setStep('preview');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  }, [source, toast]);

  const runSync = async () => {
    setBusy(true);
    try {
      const result = await api.post(`/api/jobs/${jobId}/apply`);
      setJobId(result.job.id);
      setStep('sync');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp-wizard">
      <StepIndicator current={step} />

      {step === 'welcome' ? (
        <WelcomeStep onConnect={connectGoogle} busy={busy} />
      ) : step === 'source' ? (
        <SourceStep onSelect={chooseSpreadsheet} busy={busy} onReconnect={connectGoogle} />
      ) : step === 'worksheet' ? (
        <WorksheetStep worksheets={worksheets} onSelect={chooseWorksheet} busy={busy} />
      ) : step === 'mapping' ? (
        <MappingStep
          state={mappingState}
          onChange={(mappings) => setMappingState((current) => ({ ...current, mappings }))}
          onContinue={saveMappings}
          busy={busy}
        />
      ) : step === 'rules' ? (
        <RulesStep sourceId={source.id} onContinue={buildPreview} busy={busy} />
      ) : step === 'preview' ? (
        <PreviewStep jobId={jobId} onApply={runSync} busy={busy} />
      ) : (
        <SyncStep jobId={jobId} onDone={() => router.push('/')} />
      )}
    </div>
  );
}

function WelcomeStep({ onConnect, busy }) {
  return (
    <Card>
      <div className="text-center py-4">
        <h1 style={{ fontSize: 26 }}>Turn your supplier catalog into a Shopify store.</h1>
        <p className="cp-subdued mt-3 mx-auto" style={{ maxWidth: 520 }}>
          Connect the spreadsheet your supplier already sends you. CatalogPilot reads the columns,
          matches them to Shopify fields, applies your pricing rules, and keeps everything in sync —
          without asking you to restructure the sheet.
        </p>

        <div className="row g-3 my-4 text-start mx-auto" style={{ maxWidth: 680 }}>
          <Highlight title="Smart column mapping" body="Recognises the column names suppliers actually use." />
          <Highlight title="Rules, not spreadsheets" body="Set your markup and stock policy once." />
          <Highlight title="Preview before anything changes" body="See every edit, and why, before it runs." />
        </div>

        <button type="button" className="cp-btn cp-btn-primary" onClick={onConnect} disabled={busy}>
          {busy ? 'Opening Google…' : 'Connect Google Sheet'}
        </button>
        <p className="cp-subdued mt-3 mb-0" style={{ fontSize: 12.5 }}>
          CatalogPilot only reads the spreadsheets you choose.
        </p>
      </div>
    </Card>
  );
}

function Highlight({ title, body }) {
  return (
    <div className="col-12 col-md-4">
      <div style={{ borderLeft: '2px solid var(--cp-border)', paddingLeft: 12 }}>
        <strong className="d-block" style={{ fontSize: 13.5 }}>
          {title}
        </strong>
        <span className="cp-subdued" style={{ fontSize: 12.5 }}>
          {body}
        </span>
      </div>
    </div>
  );
}

function SourceStep({ onSelect, busy, onReconnect }) {
  const [files, setFiles] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api
        .get(`/api/google/spreadsheets${query ? `?q=${encodeURIComponent(query)}` : ''}`)
        .then((data) => {
          if (!cancelled) {
            setFiles(data.files);
            setError(null);
          }
        })
        .catch((caught) => {
          if (!cancelled) setError(caught);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  if (error?.code === 'google_not_connected' || error?.status === 428) {
    return (
      <Card>
        <EmptyState
          icon="⚠"
          title="Your Google connection needs renewing"
          description={error.message}
          action={
            <button type="button" className="cp-btn cp-btn-primary" onClick={onReconnect}>
              Reconnect Google
            </button>
          }
        />
      </Card>
    );
  }

  return (
    <Card
      title="Choose your supplier spreadsheet"
      actions={
        <input
          type="search"
          className="cp-input"
          style={{ width: 220 }}
          placeholder="Search spreadsheets"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search your spreadsheets"
        />
      }
    >
      {!files ? (
        <div className="row g-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="col-12 col-md-6">
              <Skeleton height={86} />
            </div>
          ))}
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon="◇"
          title="No spreadsheets found"
          description={
            query
              ? `Nothing matched “${query}”. Try a different search.`
              : 'The connected Google account has no spreadsheets yet. Create one, or connect a different account.'
          }
        />
      ) : (
        <div className="row g-3">
          {files.map((file) => (
            <div key={file.id} className="col-12 col-md-6">
              <button
                type="button"
                className="cp-source-card"
                aria-pressed={selected === file.id}
                onClick={() => {
                  setSelected(file.id);
                  onSelect(file);
                }}
                disabled={busy}
              >
                <span style={{ fontWeight: 600 }} className="cp-truncate">
                  {file.name}
                </span>
                <span className="cp-subdued" style={{ fontSize: 12.5 }}>
                  Modified {formatDate(file.modifiedAt, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                {file.owner ? (
                  <span className="cp-subdued" style={{ fontSize: 12 }}>
                    Owner: {file.owner}
                  </span>
                ) : null}
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WorksheetStep({ worksheets, onSelect, busy }) {
  return (
    <Card title="Which worksheet holds your products?">
      <div className="row g-3">
        {worksheets.map((worksheet) => (
          <div key={worksheet.sheetId} className="col-12 col-md-6">
            <button
              type="button"
              className="cp-source-card"
              onClick={() => onSelect(worksheet)}
              disabled={busy}
            >
              <span style={{ fontWeight: 600 }}>{worksheet.title}</span>
              <span className="cp-subdued" style={{ fontSize: 12.5 }}>
                {formatNumber(worksheet.rowCount)} rows · {worksheet.columnCount} columns
              </span>
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function MappingStep({ state, onChange, onContinue, busy }) {
  if (!state) return <Skeleton height={300} />;

  return (
    <Card
      title="Review the column mapping"
      padded={false}
      footer={
        <div className="cp-spread">
          <span className="cp-subdued" style={{ fontSize: 12.5 }}>
            {formatNumber(state.rowCount)} rows ready to sync
          </span>
          <button type="button" className="cp-btn cp-btn-primary" onClick={onContinue} disabled={busy}>
            {busy ? 'Saving…' : 'Continue to rules'}
          </button>
        </div>
      }
    >
      <div className="cp-card-body" style={{ paddingBottom: 0 }}>
        <Banner tone="info">
          CatalogPilot matched your columns automatically. Check anything marked “needs review” — a wrong
          price or SKU mapping is the one mistake that is expensive to undo.
        </Banner>
      </div>
      <MappingTable
        mappings={state.mappings}
        availableFields={state.availableFields}
        headers={state.headers}
        sample={state.sample}
        onChange={onChange}
      />
    </Card>
  );
}

function RulesStep({ sourceId, onContinue, busy }) {
  return (
    <div className="cp-stack">
      <RuleQuickStart sourceId={sourceId} />
      <Card>
        <div className="cp-spread">
          <span className="cp-subdued">
            Rules are optional — you can add them later from the Automation section.
          </span>
          <button type="button" className="cp-btn cp-btn-primary" onClick={onContinue} disabled={busy}>
            {busy ? 'Building preview…' : 'Preview changes'}
          </button>
        </div>
      </Card>
    </div>
  );
}

function PreviewStep({ jobId, onApply, busy }) {
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
        // Keep polling while the preview is still being built.
        if (result.job.status === 'QUEUED' || result.job.status === 'RUNNING') {
          timer = setTimeout(load, 2000);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, filter, page, search]);

  const building = data?.job?.status === 'QUEUED' || data?.job?.status === 'RUNNING';
  const applicable = (data?.summary?.CREATE || 0) + (data?.summary?.UPDATE || 0);

  return (
    <Card
      title="Here is exactly what will happen"
      padded={false}
      footer={
        <div className="cp-spread">
          <span className="cp-subdued" style={{ fontSize: 12.5 }}>
            {building ? 'Still analysing your sheet…' : `${formatNumber(applicable)} products will be changed`}
          </span>
          <button
            type="button"
            className="cp-btn cp-btn-primary"
            onClick={onApply}
            disabled={busy || building || applicable === 0}
          >
            {busy ? 'Starting…' : 'Approve and sync'}
          </button>
        </div>
      }
    >
      {building ? (
        <div className="cp-card-body">
          <ProgressBar value={1} max={3} label="Reading your sheet and comparing it with Shopify" />
        </div>
      ) : null}
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
    </Card>
  );
}

function SyncStep({ jobId, onDone }) {
  const [job, setJob] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const result = await api.get(`/api/jobs/${jobId}`);
        if (cancelled) return;
        setJob(result.job);
        if (result.job.status === 'QUEUED' || result.job.status === 'RUNNING') {
          timer = setTimeout(poll, 1500);
        }
      } catch {
        // Keep the last known state rather than blanking the screen.
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const done = job && !['QUEUED', 'RUNNING'].includes(job.status);

  return (
    <Card title={done ? 'Sync complete' : 'Syncing your products'}>
      {!job ? (
        <Skeleton height={80} />
      ) : done ? (
        <div className="cp-stack">
          <Banner tone={job.failed > 0 ? 'warning' : 'success'}>
            {formatNumber(job.created)} products created, {formatNumber(job.updated)} updated
            {job.failed > 0 ? `, ${formatNumber(job.failed)} need attention` : ''}.
          </Banner>
          <div className="cp-inline">
            <button type="button" className="cp-btn cp-btn-primary" onClick={onDone}>
              Go to dashboard
            </button>
            {job.failed > 0 ? (
              <a href="/sync/errors" className="cp-btn">
                Review what needs attention
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="cp-stack">
          <ProgressBar
            value={job.processed}
            max={job.total || 1}
            label={`${formatNumber(job.processed)} / ${formatNumber(job.total)} products`}
          />
          <div className="cp-inline">
            <Badge tone="success">{formatNumber(job.created)} created</Badge>
            <Badge tone="info">{formatNumber(job.updated)} updated</Badge>
            {job.failed > 0 ? <Badge tone="critical">{formatNumber(job.failed)} failed</Badge> : null}
          </div>
          <p className="cp-subdued mb-0" style={{ fontSize: 12.5 }}>
            You can leave this page — the sync keeps running.
          </p>
        </div>
      )}
    </Card>
  );
}
