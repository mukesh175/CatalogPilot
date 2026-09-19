import { withAuth, json, apiError } from '../../../../lib/api.js';
import { importFile, FileImportError, MAX_UPLOAD_BYTES } from '../../../../services/file-source.js';
import { PlanLimitError } from '../../../../services/job-service.js';

/**
 * CSV / Excel upload.
 *
 * The file is parsed and staged server-side; the browser never holds the rows.
 * Re-uploading over an existing source keeps its id, so mappings, rules and
 * product links survive a refreshed supplier file.
 */
export const POST = withAuth(async (request, { shopId, log }) => {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return apiError('Upload the file as multipart form data.', { status: 415, code: 'unsupported_media_type' });
  }

  const form = await request.formData();
  const file = form.get('file');
  const dataSourceId = form.get('dataSourceId') || null;

  if (!file || typeof file === 'string') {
    return apiError('Choose a file to upload.', { status: 400, code: 'no_file' });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return apiError('That file is larger than 20MB.', { status: 413, code: 'file_too_large' });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await importFile({
      shopId,
      filename: file.name,
      buffer,
      dataSourceId: typeof dataSourceId === 'string' && dataSourceId ? dataSourceId : null,
    });

    log.info('source.upload', { dataSourceId: result.source.id, rows: result.rowCount });

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
    if (error instanceof FileImportError) {
      return apiError(error.message, {
        status: 422,
        code: 'file_unreadable',
        details: { suggestion: error.suggestion },
      });
    }
    if (error instanceof PlanLimitError) {
      return apiError(error.message, { status: 402, code: 'plan_limit', details: { upgradeTo: error.upgradeTo } });
    }
    throw error;
  }
});
