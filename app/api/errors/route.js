import { withAuth, json } from '../../../lib/api.js';
import { listErrors } from '../../../services/error-center.js';
import { paginationSchema } from '../../../validators/index.js';

export const GET = withAuth(async (request, { shopId }) => {
  const url = new URL(request.url);
  const { page, pageSize } = paginationSchema.parse(Object.fromEntries(url.searchParams.entries()));
  const syncJobId = url.searchParams.get('jobId') || undefined;
  const kind = url.searchParams.get('kind') || undefined;

  const result = await listErrors({ shopId, syncJobId, kind, page, pageSize });

  return json({
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
    errors: result.errors.map((error) => ({
      id: error.id,
      kind: error.kind,
      message: error.message,
      suggestion: error.suggestion,
      field: error.field,
      sku: error.sku,
      rowNumber: error.rowNumber,
      productTitle: error.productTitle,
      isRetryable: error.isRetryable,
      retryCount: error.retryCount,
      createdAt: error.createdAt,
      job: { id: error.syncJob.id, at: error.syncJob.createdAt },
      source: error.syncJob.dataSource,
    })),
  });
});
