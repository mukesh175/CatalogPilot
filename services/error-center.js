import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { ShopifyApiError, ShopifyAuthError } from '../lib/shopify/client.js';
import { GoogleAuthError } from '../lib/google/oauth.js';
import { RuleError } from './rules-engine.js';

/**
 * Error translation and retry.
 *
 * The rule here is that a merchant never reads a stack trace or a raw API
 * message as the primary text. Every failure is turned into: what happened,
 * why, and what to do about it. The original detail is kept in `detail` for
 * support, after redaction.
 */

const PATTERNS = [
  {
    match: (e) => /404|not found/i.test(e.message) && /image|media/i.test(e.message),
    kind: 'IMAGE',
    message: 'The image could not be downloaded.',
    suggestion: 'Open the image URL in a browser. If it does not load, update it in your sheet.',
    isRetryable: true,
  },
  {
    match: (e) => /image|media/i.test(e.message) && /invalid|unsupported|failed/i.test(e.message),
    kind: 'IMAGE',
    message: 'Shopify could not process this image.',
    suggestion: 'Use a direct link to a JPG, PNG or WEBP file under 20MB.',
    isRetryable: true,
  },
  {
    match: (e) => /handle.*(taken|already)/i.test(e.message),
    kind: 'VALIDATION',
    message: 'Another product in your store already uses this URL handle.',
    suggestion: 'Change the product title slightly, or map a Handle column with a unique value.',
    isRetryable: false,
  },
  {
    match: (e) => /sku.*(taken|duplicate|already)/i.test(e.message),
    kind: 'VALIDATION',
    message: 'This SKU is already used by a different product in your store.',
    suggestion: 'Give the row a unique SKU, or remove the duplicate product in Shopify.',
    isRetryable: false,
  },
  {
    match: (e) => /barcode.*(taken|duplicate)/i.test(e.message),
    kind: 'VALIDATION',
    message: 'This barcode is already assigned to another variant.',
    suggestion: 'Correct the barcode in your sheet, or clear the barcode mapping.',
    isRetryable: false,
  },
  {
    match: (e) => /not stocked|inventory item.*location/i.test(e.message),
    kind: 'SHOPIFY_API',
    message: 'This product is not stocked at your inventory location yet.',
    suggestion: 'CatalogPilot will stock it automatically on the next run — retry this row.',
    isRetryable: true,
  },
  {
    match: (e) => /exceeded|limit|maximum/i.test(e.message) && /variant/i.test(e.message),
    kind: 'SHOPIFY_API',
    message: 'This product already has the maximum number of variants Shopify allows.',
    suggestion: 'Split the product across several products in your sheet.',
    isRetryable: false,
  },
];

/**
 * Converts any thrown value into merchant-facing copy.
 * Returns { kind, message, suggestion, field, code, isRetryable, detail }.
 */
export function describeError(error, context = {}) {
  const base = { field: context.field || null, code: null, detail: null };

  if (error instanceof RuleError) {
    return {
      ...base,
      kind: 'VALIDATION',
      message: `A rule could not be applied: ${error.message}`,
      suggestion: 'Check the rule formula and the columns it reads from.',
      field: error.field || 'rule',
      isRetryable: false,
    };
  }

  if (error instanceof GoogleAuthError) {
    return {
      ...base,
      kind: 'GOOGLE_API',
      code: error.code,
      message: error.message,
      suggestion: error.needsReconnect
        ? 'Reconnect your Google account in Settings → Connections.'
        : 'Check that the connected Google account can still open this spreadsheet.',
      isRetryable: !error.needsReconnect,
    };
  }

  if (error instanceof ShopifyAuthError) {
    return {
      ...base,
      kind: 'PERMISSION',
      code: 'shopify_unauthorized',
      message: 'CatalogPilot no longer has permission to change your products.',
      suggestion: 'Open the app from your Shopify admin to restore access.',
      isRetryable: false,
    };
  }

  if (error instanceof ShopifyApiError) {
    for (const pattern of PATTERNS) {
      if (pattern.match(error)) {
        return {
          ...base,
          kind: pattern.kind,
          code: error.code,
          message: pattern.message,
          suggestion: pattern.suggestion,
          isRetryable: pattern.isRetryable,
          detail: { shopify: error.userErrors?.slice(0, 5) || null },
        };
      }
    }

    if (error.code === 'throttled' || error.code === 'rate_limited') {
      return {
        ...base,
        kind: 'RATE_LIMIT',
        code: error.code,
        message: 'Shopify asked us to slow down, so this row was not processed.',
        suggestion: 'Retry — CatalogPilot will pace the requests automatically.',
        isRetryable: true,
      };
    }

    return {
      ...base,
      kind: 'SHOPIFY_API',
      code: error.code,
      message: firstUserError(error) || 'Shopify rejected this change.',
      suggestion: 'Check the highlighted values in your sheet, then retry this row.',
      isRetryable: true,
      detail: { shopify: error.userErrors?.slice(0, 5) || null },
    };
  }

  logger.error('error_center.untranslated', { error, ...context });
  return {
    ...base,
    kind: 'UNKNOWN',
    message: 'Something went wrong while syncing this row.',
    suggestion: 'Retry this row. If it keeps failing, contact support with the SKU.',
    isRetryable: true,
  };
}

function firstUserError(error) {
  const first = error.userErrors?.[0];
  if (!first) return null;
  const field = Array.isArray(first.field) ? first.field.filter((f) => f !== 'input').join(' ') : '';
  return field ? `${capitalize(field)}: ${first.message}` : first.message;
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

/**
 * Re-queues the rows behind a set of errors.
 * Only retryable errors are re-queued; the rest are reported back untouched so
 * the UI can explain why a retry would not help.
 */
export async function retryErrors({ shopId, syncJobId, errorIds = null, mode = 'selected' }) {
  const where = {
    syncJob: { shopId },
    resolvedAt: null,
    ignoredAt: null,
    ...(syncJobId ? { syncJobId } : {}),
    ...(errorIds ? { id: { in: errorIds } } : {}),
    ...(mode === 'compatible' ? { isRetryable: true } : {}),
  };

  const errors = await prisma.syncError.findMany({ where, include: { syncJob: true } });
  const retryable = errors.filter((e) => e.isRetryable);
  const skipped = errors.filter((e) => !e.isRetryable);

  if (retryable.length === 0) {
    return { requeued: 0, skipped: skipped.length, jobIds: [] };
  }

  const itemIds = retryable.map((e) => e.syncJobItemId).filter(Boolean);
  if (itemIds.length) {
    await prisma.syncJobItem.updateMany({
      where: { id: { in: itemIds }, syncJob: { shopId } },
      data: { status: 'PENDING' },
    });
  }

  await prisma.syncError.updateMany({
    where: { id: { in: retryable.map((e) => e.id) } },
    data: { resolvedAt: new Date(), retryCount: { increment: 1 } },
  });

  const jobIds = [...new Set(retryable.map((e) => e.syncJobId))];
  await prisma.syncJob.updateMany({
    where: { id: { in: jobIds }, shopId, status: { in: ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED'] } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null, cancelRequested: false },
  });

  logger.info('error_center.retry', { shopId, requeued: retryable.length, jobIds });
  return { requeued: retryable.length, skipped: skipped.length, jobIds };
}

/** Dismisses errors the merchant chose to ignore. */
export async function ignoreErrors({ shopId, errorIds }) {
  const { count } = await prisma.syncError.updateMany({
    where: { id: { in: errorIds }, syncJob: { shopId }, ignoredAt: null },
    data: { ignoredAt: new Date() },
  });
  return { ignored: count };
}

/** Errors needing attention, newest first, with their source row. */
export async function listErrors({ shopId, syncJobId, kind, page = 1, pageSize = 25 }) {
  const where = {
    syncJob: { shopId },
    ignoredAt: null,
    resolvedAt: null,
    ...(syncJobId ? { syncJobId } : {}),
    ...(kind ? { kind } : {}),
  };

  const [total, errors] = await Promise.all([
    prisma.syncError.count({ where }),
    prisma.syncError.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        syncJob: {
          select: { id: true, createdAt: true, dataSource: { select: { id: true, name: true, spreadsheetId: true } } },
        },
      },
    }),
  ]);

  return { total, page, pageSize, errors };
}
