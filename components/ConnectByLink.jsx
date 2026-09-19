'use client';

import { useState } from 'react';
import { api } from '../lib/client-api.js';
import { useApi } from '../lib/use-api.js';
import { useToast } from './AppProviders.jsx';
import { Card, Banner, Badge, Skeleton } from './ui.jsx';

/**
 * Connecting a sheet without Google OAuth.
 *
 * Both options exist because OAuth with Google's sensitive scopes cannot be
 * offered publicly until the app passes Google verification. The privacy
 * difference between the two is stated up front, because "publish to web"
 * genuinely does expose supplier pricing to anyone holding the link.
 */
export function ConnectByLink({ onConnected }) {
  const toast = useToast();
  const { data, loading } = useApi('/api/sources/link');

  const [mode, setMode] = useState('shared');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const shareWith = data?.shared?.shareWith;
  const sharedAvailable = data?.shared?.available;

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);

    try {
      const body = mode === 'shared' ? { mode: 'shared', link } : { mode: 'csv_url', url: link };
      const result = await api.post('/api/sources/link', body);
      toast.success(`Connected ${result.source.name}.`);
      setLink('');
      onConnected?.(result);
    } catch (error) {
      setProblem({
        message: error.message,
        suggestion: error.details?.suggestion,
        shareWith: error.details?.shareWith,
      });
    } finally {
      setBusy(false);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(shareWith);
      toast.success('Address copied.');
    } catch {
      toast.error('Could not copy. Select the address and copy it manually.');
    }
  };

  if (loading) {
    return (
      <Card title="Connect a sheet by link">
        <Skeleton height={140} />
      </Card>
    );
  }

  return (
    <Card title="Connect a sheet by link">
      <div className="cp-inline mb-4" role="group" aria-label="How to connect">
        <button
          type="button"
          className={`cp-btn cp-btn-sm${mode === 'shared' ? ' cp-btn-primary' : ''}`}
          aria-pressed={mode === 'shared'}
          onClick={() => {
            setMode('shared');
            setProblem(null);
          }}
          disabled={!sharedAvailable}
          title={sharedAvailable ? undefined : 'Not enabled on this installation'}
        >
          Share with CatalogPilot
        </button>
        <button
          type="button"
          className={`cp-btn cp-btn-sm${mode === 'csv_url' ? ' cp-btn-primary' : ''}`}
          aria-pressed={mode === 'csv_url'}
          onClick={() => {
            setMode('csv_url');
            setProblem(null);
          }}
        >
          Published CSV link
        </button>
      </div>

      {mode === 'shared' ? (
        <div className="cp-stack">
          <Banner tone="success" title="Your sheet stays private">
            Only this one address can read it, and only the sheet you share. Nothing else in your Drive is
            visible to CatalogPilot.
          </Banner>

          {!sharedAvailable ? (
            <Banner tone="warning">
              Shared sheets are not enabled on this installation yet.
            </Banner>
          ) : (
            <>
              <ol className="cp-stack-sm ps-3 mb-0" style={{ fontSize: 13.5 }}>
                <li>Open your supplier sheet in Google Sheets.</li>
                <li>
                  Click <strong>Share</strong>, paste the address below, and choose{' '}
                  <strong>Viewer</strong>.
                </li>
                <li>Copy the sheet&apos;s link from your browser and paste it here.</li>
              </ol>

              <div
                className="cp-spread p-3"
                style={{ background: 'var(--cp-surface-sunken)', borderRadius: 'var(--cp-radius)' }}
              >
                <code className="cp-mono" style={{ wordBreak: 'break-all' }}>
                  {shareWith}
                </code>
                <button type="button" className="cp-btn cp-btn-sm" onClick={copyEmail}>
                  Copy
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="cp-stack">
          <Banner tone="warning" title="This makes the sheet readable by anyone with the link">
            Google publishes it publicly. If the sheet contains supplier cost prices, use the
            &ldquo;Share with CatalogPilot&rdquo; option instead — it keeps the sheet private.
          </Banner>

          <ol className="cp-stack-sm ps-3 mb-0" style={{ fontSize: 13.5 }}>
            <li>
              In Google Sheets choose <strong>File → Share → Publish to web</strong>.
            </li>
            <li>
              Pick the worksheet, then choose <strong>Comma-separated values (.csv)</strong>.
            </li>
            <li>
              Click <strong>Publish</strong> and paste the link it gives you here.
            </li>
          </ol>
        </div>
      )}

      <form onSubmit={submit} className="mt-4">
        <div className="cp-field">
          <label className="cp-label" htmlFor="source-link">
            {mode === 'shared' ? 'Google Sheets link' : 'Published CSV link'}
          </label>
          <input
            id="source-link"
            type="url"
            className="cp-input"
            required
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder={
              mode === 'shared'
                ? 'https://docs.google.com/spreadsheets/d/…'
                : 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv'
            }
            aria-invalid={problem ? 'true' : undefined}
            aria-describedby={problem ? 'source-link-problem' : undefined}
          />
        </div>

        {problem ? (
          <div id="source-link-problem" className="mb-3">
            <Banner tone="critical" title={problem.message}>
              {problem.suggestion}
              {problem.shareWith ? (
                <div className="mt-2">
                  <Badge tone="info">{problem.shareWith}</Badge>
                </div>
              ) : null}
            </Banner>
          </div>
        ) : null}

        <button type="submit" className="cp-btn cp-btn-primary" disabled={busy || !link.trim()}>
          {busy ? 'Checking the link…' : 'Connect sheet'}
        </button>
      </form>
    </Card>
  );
}
