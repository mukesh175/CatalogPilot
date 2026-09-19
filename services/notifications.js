import prisma from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { logger } from '../lib/logger.js';

/**
 * Notification delivery.
 *
 * Email is optional: when SMTP is not configured the notification is still
 * recorded in the log and shown in-app, so the product degrades cleanly rather
 * than pretending to have sent something.
 */

const TEMPLATES = {
  sync_completed: (ctx) => ({
    subject: `Sync finished — ${ctx.created} created, ${ctx.updated} updated`,
    body: [
      `Your ${ctx.sourceName} sync finished in ${formatDuration(ctx.durationMs)}.`,
      '',
      `Scanned:   ${ctx.scanned}`,
      `Created:   ${ctx.created}`,
      `Updated:   ${ctx.updated}`,
      `Unchanged: ${ctx.unchanged}`,
      `Failed:    ${ctx.failed}`,
    ].join('\n'),
  }),
  sync_failed: (ctx) => ({
    subject: `Sync failed — ${ctx.sourceName}`,
    body: [
      `The sync for ${ctx.sourceName} could not complete.`,
      '',
      ctx.message || 'Open the Error Center in CatalogPilot to see what needs attention.',
    ].join('\n'),
  }),
  attention_required: (ctx) => ({
    subject: `${ctx.count} products need attention`,
    body: `The last sync of ${ctx.sourceName} finished with ${ctx.count} rows that need your attention. Open the Error Center to review them.`,
  }),
  google_expired: (ctx) => ({
    subject: 'Your Google connection needs renewing',
    body: `CatalogPilot can no longer read ${ctx.sourceName}. Reconnect your Google account in Settings → Connections to resume syncing.`,
  }),
  shopify_issue: () => ({
    subject: 'CatalogPilot lost access to your store',
    body: 'Open CatalogPilot from your Shopify admin to restore access.',
  }),
};

const PREFERENCE_KEYS = {
  sync_completed: 'onSyncCompleted',
  sync_failed: 'onSyncFailed',
  attention_required: 'onAttentionRequired',
  google_expired: 'onConnectionExpired',
  shopify_issue: 'onConnectionExpired',
};

/**
 * Sends a notification if the shop opted into that event.
 * Never throws — a notification failure must not fail a sync.
 */
export async function notify(shopId, event, context = {}) {
  try {
    const settings = await prisma.notificationSetting.findUnique({ where: { shopId } });
    const preferenceKey = PREFERENCE_KEYS[event];
    if (!settings || (preferenceKey && settings[preferenceKey] === false)) return false;

    const template = TEMPLATES[event];
    if (!template) return false;

    const { subject, body } = template(context);
    const recipient = settings.email;

    if (!recipient) {
      logger.info('notification.skipped_no_recipient', { shopId, event });
      return false;
    }

    const sent = await deliver({ to: recipient, subject, body });
    logger.info('notification.sent', { shopId, event, delivered: sent });
    return sent;
  } catch (error) {
    logger.warn('notification.failed', { shopId, event, error });
    return false;
  }
}

async function deliver({ to, subject, body }) {
  const config = env();
  if (!config.SMTP_URL) {
    logger.info('notification.email_not_configured', { subject });
    return false;
  }

  // Loaded on demand: an install without SMTP configured never pays the cost
  // of pulling the transport into a serverless function's cold start.
  const { default: nodemailer } = await import('nodemailer');

  const transport = nodemailer.createTransport(config.SMTP_URL);
  await transport.sendMail({
    from: config.NOTIFICATION_FROM_EMAIL || 'notifications@catalogpilot.app',
    to,
    subject,
    text: body,
  });
  return true;
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return 'under a second';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${seconds % 60} seconds`;
}

/** Notifications the dashboard shows as "attention required". */
export async function attentionItems(shopId) {
  const [errorCount, expiredConnections, failedJobs] = await Promise.all([
    prisma.syncError.count({
      where: { syncJob: { shopId }, resolvedAt: null, ignoredAt: null },
    }),
    prisma.googleConnection.count({ where: { shopId, isRevoked: true } }),
    prisma.syncJob.count({ where: { shopId, status: 'FAILED' } }),
  ]);

  const items = [];
  if (expiredConnections > 0) {
    items.push({
      kind: 'connection',
      severity: 'error',
      title: 'Google connection expired',
      description: 'Reconnect your Google account to resume syncing.',
      href: '/settings/connections',
      action: 'Reconnect',
    });
  }
  if (errorCount > 0) {
    items.push({
      kind: 'errors',
      severity: 'warning',
      title: `${errorCount} row${errorCount === 1 ? '' : 's'} need attention`,
      description: 'Review what went wrong and retry the ones you can fix.',
      href: '/sync/errors',
      action: 'Open error center',
    });
  }
  if (failedJobs > 0) {
    items.push({
      kind: 'jobs',
      severity: 'error',
      title: `${failedJobs} sync${failedJobs === 1 ? '' : 's'} failed`,
      description: 'Open sync history to see the details.',
      href: '/sync/history',
      action: 'View history',
    });
  }
  return items;
}
