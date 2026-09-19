import { withAuth, json, parseBody } from '../../../../lib/api.js';
import { ignoreErrorsSchema } from '../../../../validators/index.js';
import { ignoreErrors } from '../../../../services/error-center.js';

export const POST = withAuth(async (request, { shopId }) => {
  const { errorIds } = await parseBody(request, ignoreErrorsSchema);
  return json(await ignoreErrors({ shopId, errorIds }));
});
