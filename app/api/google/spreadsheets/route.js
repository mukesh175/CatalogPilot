import prisma from '../../../../lib/prisma.js';
import { withAuth, json, apiError } from '../../../../lib/api.js';
import { listSpreadsheets } from '../../../../services/google-sheets.js';
import { GoogleAuthError } from '../../../../lib/google/oauth.js';

/** Lists the connected Google account's spreadsheets for the source picker. */
export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const pageToken = url.searchParams.get('pageToken') || undefined;
  const query = url.searchParams.get('q') || undefined;

  const connection = await prisma.googleConnection.findFirst({
    where: { shopId, isRevoked: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!connection) {
    return apiError('Connect a Google account to browse your spreadsheets.', {
      status: 428,
      code: 'google_not_connected',
    });
  }

  try {
    const result = await listSpreadsheets(connection, { pageToken, query });

    // The worksheet count shown on each card is resolved lazily when a
    // spreadsheet is opened — fetching it for every file would mean one API
    // call per row just to render a list.
    return json({
      connection: { id: connection.id, email: connection.email },
      ...result,
    });
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return apiError(error.message, {
        status: error.needsReconnect ? 428 : 502,
        code: error.code,
      });
    }
    throw error;
  }
});
