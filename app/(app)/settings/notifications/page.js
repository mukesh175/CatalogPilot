'use client';

import { useEffect, useState } from 'react';
import { useApi } from '../../../../lib/use-api.js';
import { api } from '../../../../lib/client-api.js';
import { useToast } from '../../../../components/AppProviders.jsx';
import { Card, Banner, Skeleton, PageHeader } from '../../../../components/ui.jsx';

const EVENTS = [
  {
    key: 'onSyncCompleted',
    title: 'Sync completed',
    description: 'A summary every time a sync finishes successfully.',
  },
  {
    key: 'onSyncFailed',
    title: 'Sync failed',
    description: 'When a sync could not complete at all.',
  },
  {
    key: 'onAttentionRequired',
    title: 'Products need attention',
    description: 'When rows are skipped because something needs fixing.',
  },
  {
    key: 'onConnectionExpired',
    title: 'Connection problems',
    description: 'When your Google or Shopify connection stops working.',
  },
];

export default function NotificationsPage() {
  const toast = useToast();
  const { data, loading, error } = useApi('/api/settings/notifications');
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data?.settings) setSettings(data.settings);
  }, [data]);

  const save = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    try {
      await api.patch('/api/settings/notifications', patch);
    } catch (caught) {
      toast.error(caught.message);
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  if (loading && !settings) return <Skeleton height={260} />;
  if (error) return <Banner tone="critical">{error.message}</Banner>;
  if (!settings) return null;

  return (
    <div className="cp-stack">
      <PageHeader
        title="Notifications"
        description="Choose when CatalogPilot should email you."
      />

      {!data.emailConfigured ? (
        <Banner tone="warning" title="Email delivery is not configured">
          Your preferences are saved, but no messages will be sent until an SMTP connection is configured
          for this installation. Everything still appears in the app.
        </Banner>
      ) : null}

      <Card title="Where should we send notifications?">
        <div className="cp-field mb-0">
          <label className="cp-label" htmlFor="notification-email">
            Email address
          </label>
          <input
            id="notification-email"
            type="email"
            className="cp-input"
            style={{ maxWidth: 380 }}
            value={settings.email || ''}
            placeholder="you@example.com"
            onChange={(event) => setSettings({ ...settings, email: event.target.value })}
            onBlur={(event) => save({ email: event.target.value || null })}
          />
          <span className="cp-help">Leave empty to turn off email entirely.</span>
        </div>
      </Card>

      <Card title="What should we tell you about?">
        <div className="cp-stack">
          {EVENTS.map((event) => (
            <label key={event.key} className="cp-checkbox">
              <input
                type="checkbox"
                checked={Boolean(settings[event.key])}
                disabled={saving}
                onChange={(input) => save({ [event.key]: input.target.checked })}
              />
              <span>
                {event.title}
                <span className="cp-help">{event.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>
    </div>
  );
}
