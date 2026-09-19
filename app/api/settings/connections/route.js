import prisma from '../../../../lib/prisma.js';
import { withAuth, json, apiError } from '../../../../lib/api.js';
import { logger } from '../../../../lib/logger.js';

/** Connection status for Settings → Connections. */
export const GET = withAuth(async (request, { shopId, shop, shopRecord, missingScopes }) => {
  const connections = await prisma.googleConnection.findMany({
    where: { shopId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { dataSources: true } } },
  });

  return json({
    shopify: {
      domain: shop,
      name: shopRecord.name,
      connected: true,
      needsReauth: missingScopes.length > 0,
      missingScopes,
    },
    google: connections.map((connection) => ({
      id: connection.id,
      email: connection.email,
      isRevoked: connection.isRevoked,
      connectedAt: connection.createdAt,
      lastCheckedAt: connection.lastCheckedAt,
      sourceCount: connection._count.dataSources,
    })),
  });
});

/**
 * Disconnects a Google account.
 * The sources that depended on it are paused rather than deleted, so
 * reconnecting restores the configuration instead of losing it.
 */
export const DELETE = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get('id');
  if (!connectionId) return apiError('Which connection?', { status: 400, code: 'missing_id' });

  const connection = await prisma.googleConnection.findFirst({
    where: { id: connectionId, shopId },
  });
  if (!connection) return apiError('That connection could not be found.', { status: 404, code: 'not_found' });

  await prisma.$transaction([
    prisma.dataSource.updateMany({
      where: { googleConnectionId: connection.id },
      data: { isPaused: true, status: 'DISCONNECTED', nextRunAt: null },
    }),
    prisma.googleConnection.delete({ where: { id: connection.id } }),
  ]);

  logger.info('google.disconnected', { shopId, connectionId });
  return json({ disconnected: true });
});
