import { withAuth, json, apiError, parseBody } from '../../../lib/api.js';
import { connectSheetSchema } from '../../../validators/index.js';
import { listSources, connectSpreadsheet } from '../../../services/data-source.js';
import { PlanLimitError } from '../../../services/job-service.js';
import { GoogleAuthError } from '../../../lib/google/oauth.js';

export const GET = withAuth(async (request, { shopId }) => {
  return json({ sources: await listSources(shopId) });
});

export const POST = withAuth(async (request, { shopId }) => {
  const body = await parseBody(request, connectSheetSchema);

  try {
    const { source, worksheets } = await connectSpreadsheet({ shopId, ...body });
    return json({ source: { id: source.id, name: source.name, status: source.status }, worksheets }, { status: 201 });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return apiError(error.message, { status: 402, code: 'plan_limit', details: { upgradeTo: error.upgradeTo } });
    }
    if (error instanceof GoogleAuthError) {
      return apiError(error.message, { status: error.needsReconnect ? 428 : 502, code: error.code });
    }
    throw error;
  }
});
