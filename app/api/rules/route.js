import { withAuth, json, apiError, parseBody } from '../../../lib/api.js';
import { ruleSchema } from '../../../validators/index.js';
import { listRules, createRule } from '../../../services/rule-store.js';
import { PlanLimitError } from '../../../services/job-service.js';
import { RuleError } from '../../../services/rules-engine.js';
import { RULE_CONDITION_FIELDS } from '../../../lib/fields.js';

export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const dataSourceId = url.searchParams.get('dataSourceId');

  const rules = await listRules({ shopId, kind, dataSourceId });
  return json({
    rules,
    conditionFields: RULE_CONDITION_FIELDS.map((f) => ({ key: f.key, label: f.label, type: f.type })),
  });
});

export const POST = withAuth(async (request, { shopId }) => {
  const input = await parseBody(request, ruleSchema);

  try {
    const rule = await createRule({ shopId, input });
    return json({ rule }, { status: 201 });
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return apiError(error.message, { status: 402, code: 'plan_limit', details: { upgradeTo: error.upgradeTo } });
    }
    if (error instanceof RuleError) {
      return apiError(error.message, { status: 422, code: 'invalid_rule' });
    }
    throw error;
  }
});
