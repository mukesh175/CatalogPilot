import { withAuth, json, apiError, parseBody } from '../../../../lib/api.js';
import { connectSharedSheetSchema, connectCsvUrlSchema } from '../../../../validators/index.js';
import { connectSharedSheet, connectCsvUrl } from '../../../../services/link-source.js';
import { PlanLimitError } from '../../../../services/job-service.js';
import { FileImportError } from '../../../../services/file-source.js';
import {
  ServiceAccountError,
  serviceAccountEmail,
  serviceAccountConfigured,
} from '../../../../lib/google/service-account.js';
import { googleOAuthEnabled } from '../../../../lib/google/oauth.js';
import { z } from 'zod';

/**
 * Connecting a source by link, with no Google OAuth.
 *
 * Two modes, both of which avoid the consent screen and therefore Google's app
 * verification: a sheet shared with our service account (stays private), or a
 * sheet the merchant published as CSV (public to anyone with the link).
 */

/** What the UI needs to render the connect forms. */
export const GET = withAuth(async () =>
  json({
    shared: {
      available: serviceAccountConfigured(),
      // The address merchants grant Viewer access to. Public by nature.
      shareWith: serviceAccountEmail(),
    },
    csvUrl: { available: true },
    // Hidden until Google verifies the app; see googleOAuthEnabled().
    googleAccount: { available: googleOAuthEnabled() },
  })
);

const bodySchema = z.discriminatedUnion('mode', [
  connectSharedSheetSchema.extend({ mode: z.literal('shared') }),
  connectCsvUrlSchema.extend({ mode: z.literal('csv_url') }),
]);

export const POST = withAuth(async (request, { shopId }) => {
  const body = await parseBody(request, bodySchema);

  try {
    if (body.mode === 'shared') {
      const { source, worksheets } = await connectSharedSheet({
        shopId,
        link: body.link,
        name: body.name,
      });
      return json(
        { source: { id: source.id, name: source.name, kind: source.kind }, worksheets },
        { status: 201 }
      );
    }

    const result = await connectCsvUrl({ shopId, url: body.url, name: body.name });
    return json(
      {
        source: { id: result.source.id, name: result.source.name, kind: result.source.kind },
        headers: result.headers,
        rowCount: result.rowCount,
        sample: result.sample,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ServiceAccountError) {
      return apiError(error.message, {
        status: error.code === 'service_account_missing' ? 503 : 422,
        code: error.code,
        details: { suggestion: error.suggestion, shareWith: serviceAccountEmail() },
      });
    }
    if (error instanceof FileImportError) {
      return apiError(error.message, {
        status: 422,
        code: 'link_unreadable',
        details: { suggestion: error.suggestion },
      });
    }
    if (error instanceof PlanLimitError) {
      return apiError(error.message, {
        status: 402,
        code: 'plan_limit',
        details: { upgradeTo: error.upgradeTo },
      });
    }
    throw error;
  }
});
