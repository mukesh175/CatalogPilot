import prisma from '../../../../lib/prisma.js';
import { withAuth, json, parseBody } from '../../../../lib/api.js';
import { notificationSchema } from '../../../../validators/index.js';

export const GET = withAuth(async (request, { shopId }) => {
  const settings = await prisma.notificationSetting.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });

  return json({
    settings: {
      email: settings.email,
      onSyncCompleted: settings.onSyncCompleted,
      onSyncFailed: settings.onSyncFailed,
      onAttentionRequired: settings.onAttentionRequired,
      onConnectionExpired: settings.onConnectionExpired,
    },
    emailConfigured: Boolean(process.env.SMTP_URL),
  });
});

export const PATCH = withAuth(async (request, { shopId }) => {
  const body = await parseBody(request, notificationSchema);

  const settings = await prisma.notificationSetting.upsert({
    where: { shopId },
    create: { shopId, ...body },
    update: body,
  });

  return json({
    settings: {
      email: settings.email,
      onSyncCompleted: settings.onSyncCompleted,
      onSyncFailed: settings.onSyncFailed,
      onAttentionRequired: settings.onAttentionRequired,
      onConnectionExpired: settings.onConnectionExpired,
    },
  });
});
