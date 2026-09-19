import prisma from '../../../../../../lib/prisma.js';
import { withAuth, json, apiError } from '../../../../../../lib/api.js';
import { listWorksheets } from '../../../../../../services/google-sheets.js';
import { GoogleAuthError } from '../../../../../../lib/google/oauth.js';

/** Lists the worksheets inside one spreadsheet. */
export const GET = withAuth(async (request, { shopId, params }) => {
  const connection = await prisma.googleConnection.findFirst({
    where: { shopId, isRevoked: false },
    orderBy: { createdAt: 'desc' },
  });

  if (!connection) {
    return apiError('Connect a Google account first.', { status: 428, code: 'google_not_connected' });
  }

  try {
    const result = await listWorksheets(connection, params.spreadsheetId);
    return json(result);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return apiError(error.message, { status: error.needsReconnect ? 428 : 502, code: error.code });
    }
    throw error;
  }
});
