import { withAuth, json, apiError, parseBody } from '../../../../../lib/api.js';
import { saveMappingsSchema } from '../../../../../validators/index.js';
import { loadMappings, saveMappings } from '../../../../../services/data-source.js';
import { validateMappingSet } from '../../../../../services/mapping-engine.js';
import { TARGET_FIELDS } from '../../../../../lib/fields.js';

export const GET = withAuth(async (request, { shopId, params }) => {
  const mappings = await loadMappings(shopId, params.id);
  if (!mappings) return apiError('That data source could not be found.', { status: 404, code: 'not_found' });

  return json({
    mappings,
    validation: validateMappingSet(mappings),
    availableFields: TARGET_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      group: f.group,
      type: f.type,
      required: Boolean(f.required),
      risk: f.risk,
    })),
  });
});

export const PUT = withAuth(async (request, { shopId, params }) => {
  const { mappings } = await parseBody(request, saveMappingsSchema);

  try {
    const result = await saveMappings({ shopId, dataSourceId: params.id, mappings });
    return json({ ...result, mappings: await loadMappings(shopId, params.id) });
  } catch (error) {
    if (/mapped to|only be filled once/i.test(error.message)) {
      return apiError(error.message, { status: 409, code: 'duplicate_mapping' });
    }
    throw error;
  }
});
