'use client';

import { useState } from 'react';
import { useApi } from '../../../../lib/use-api.js';
import { api, formatDate, formatRelative } from '../../../../lib/client-api.js';
import { useToast, useConfirm } from '../../../../components/AppProviders.jsx';
import { Card, Banner, Badge, Skeleton, PageHeader, EmptyState } from '../../../../components/ui.jsx';

export default function ConnectionsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, error, refresh } = useApi('/api/settings/connections');
  // Google sign-in is hidden until Google has verified the app; the server is
  // the single source of truth for that.
  const { data: capabilities } = useApi('/api/sources/link');
  const googleAvailable = capabilities?.googleAccount?.available;
  const [connecting, setConnecting] = useState(false);

  const connectGoogle = async () => {
    setConnecting(true);
    try {
      const { url } = await api.get('/api/auth/google/start');
      window.open(url, '_top');
    } catch (caught) {
      toast.error(caught.message);
      setConnecting(false);
    }
  };

  const disconnect = async (connection) => {
    const ok = await confirm({
      title: 'Disconnect this Google account?',
      body: `Sources using ${connection.email} will be paused. Your Shopify products are not changed. Reconnecting the same account restores the setup.`,
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/api/settings/connections?id=${connection.id}`);
      toast.success('Google account disconnected.');
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  if (loading && !data) return <Skeleton height={260} />;
  if (error) return <Banner tone="critical">{error.message}</Banner>;

  return (
    <div className="cp-stack">
      <PageHeader title="Connections" description="The accounts CatalogPilot uses on your behalf." />

      <Card title="Shopify">
        <div className="cp-spread flex-wrap gap-3">
          <div>
            <div style={{ fontWeight: 550 }}>{data.shopify.name || data.shopify.domain}</div>
            <div className="cp-subdued" style={{ fontSize: 12.5 }}>
              {data.shopify.domain}
            </div>
          </div>
          <Badge tone={data.shopify.needsReauth ? 'warning' : 'success'}>
            {data.shopify.needsReauth ? 'Needs reauthorization' : 'Connected'}
          </Badge>
        </div>

        {data.shopify.needsReauth ? (
          <Banner tone="warning" title="New permissions are needed" >
            CatalogPilot needs {data.shopify.missingScopes.join(', ')}. Close and reopen the app from your
            Shopify admin to approve the update.
          </Banner>
        ) : null}
      </Card>

      {googleAvailable ? (
      <Card
        title="Google"
        actions={
          <button type="button" className="cp-btn cp-btn-primary" onClick={connectGoogle} disabled={connecting}>
            {connecting ? 'Opening Google…' : data.google.length ? 'Connect another account' : 'Connect Google'}
          </button>
        }
      >
        {data.google.length === 0 ? (
          <EmptyState
            icon="◇"
            title="No Google account connected"
            description="Connect the Google account that can open your supplier spreadsheets."
            action={
              <button type="button" className="cp-btn cp-btn-primary" onClick={connectGoogle}>
                Connect Google
              </button>
            }
          />
        ) : (
          <div className="cp-stack-sm">
            {data.google.map((connection) => (
              <div
                key={connection.id}
                className="cp-spread flex-wrap gap-3 p-3"
                style={{ border: '1px solid var(--cp-border)', borderRadius: 'var(--cp-radius)' }}
              >
                <div>
                  <div style={{ fontWeight: 550 }}>{connection.email}</div>
                  <div className="cp-subdued" style={{ fontSize: 12.5 }}>
                    Connected {formatDate(connection.connectedAt)} · {connection.sourceCount} source
                    {connection.sourceCount === 1 ? '' : 's'}
                    {connection.lastCheckedAt ? ` · checked ${formatRelative(connection.lastCheckedAt)}` : ''}
                  </div>
                </div>

                <div className="cp-inline">
                  <Badge tone={connection.isRevoked ? 'critical' : 'success'}>
                    {connection.isRevoked ? 'Needs reconnecting' : 'Active'}
                  </Badge>
                  {connection.isRevoked ? (
                    <button type="button" className="cp-btn cp-btn-sm" onClick={connectGoogle}>
                      Reconnect
                    </button>
                  ) : null}
                  <button type="button" className="cp-btn cp-btn-sm" onClick={() => disconnect(connection)}>
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="cp-subdued mt-3 mb-0" style={{ fontSize: 12.5 }}>
          CatalogPilot requests read access to your spreadsheet list and read/write access to the sheets you
          select. Tokens are encrypted before they are stored.
        </p>
      </Card>
      ) : null}

      {capabilities?.shared?.available ? (
        <Card title="Shared sheets">
          <p className="cp-subdued">
            Share a Google Sheet with the address below and CatalogPilot can read it — no sign-in, and
            nothing else in your Drive is visible.
          </p>
          <div
            className="cp-spread p-3"
            style={{ background: 'var(--cp-surface-sunken)', borderRadius: 'var(--cp-radius)' }}
          >
            <code className="cp-mono" style={{ wordBreak: 'break-all' }}>
              {capabilities.shared.shareWith}
            </code>
            <Badge tone="success">Read only</Badge>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
