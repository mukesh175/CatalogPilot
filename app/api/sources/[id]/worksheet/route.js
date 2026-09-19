import { withAuth, json, apiError, parseBody } from '../../../../../lib/api.js';
import { selectWorksheetSchema } from '../../../../../validators/index.js';
import { selectWorksheet } from '../../../../../services/data-source.js';
import { GoogleAuthError } from '../../../../../lib/google/oauth.js';

/**
 * Selects the worksheet to sync from and returns the mapping proposal.
 * The sample rows come back with it so the mapping screen can show real data
 * next to each suggested field.
 */
export const PUT = withAuth(async (request, { shopId, params }) => {
  const body = await parseBody(request, selectWorksheetSchema);

  try {
    const result = await selectWorksheet({ shopId, dataSourceId: params.id, ...body });
    return json(result);
  } catch (error) {
    if (error instanceof GoogleAuthError) {
      return apiError(error.message, { status: error.needsReconnect ? 428 : 502, code: error.code });
    }
    if (/empty|does not exist/i.test(error.message)) {
      return apiError(error.message, { status: 422, code: 'worksheet_unusable' });
    }
    throw error;
  }
});
