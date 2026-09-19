import { withAuth, json, apiError, parseBody } from '../../../../lib/api.js';
import { ruleSchema } from '../../../../validators/index.js';
import { updateRule, deleteRule } from '../../../../services/rule-store.js';
import { RuleError } from '../../../../services/rules-engine.js';

export const PUT = withAuth(async (request, { shopId, params }) => {
  const input = await parseBody(request, ruleSchema);

  try {
    const rule = await updateRule({ shopId, ruleId: params.id, input });
    if (!rule) return apiError('That rule could not be found.', { status: 404, code: 'not_found' });
    return json({ rule });
  } catch (error) {
    if (error instanceof RuleError) {
      return apiError(error.message, { status: 422, code: 'invalid_rule' });
    }
    throw error;
  }
});

export const DELETE = withAuth(async (request, { shopId, params }) => {
  const deleted = await deleteRule({ shopId, ruleId: params.id });
  if (!deleted) return apiError('That rule could not be found.', { status: 404, code: 'not_found' });
  return json({ deleted: true });
});
