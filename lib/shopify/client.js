import { env } from '../env.js';
import { logger } from '../logger.js';

/**
 * Admin GraphQL client with rate-limit awareness and bounded retries.
 *
 * Shopify's GraphQL API uses a leaky-bucket cost model. Two things matter:
 *  - THROTTLED responses must back off until the bucket refills, and the
 *    response tells us exactly how much is available and how fast it restores.
 *  - 5xx / network failures are retried with exponential backoff + jitter.
 * Everything else surfaces immediately as a typed error.
 */

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;

export class ShopifyApiError extends Error {
  constructor(
    message,
    { status, code, userErrors, retryable = false, requestId, operation, fields } = {}
  ) {
    super(message);
    this.name = 'ShopifyApiError';
    this.status = status;
    this.code = code;
    this.userErrors = userErrors || [];
    this.retryable = retryable;
    this.requestId = requestId;
    // Which mutation, and which fields it objected to. Carried so the error
    // center can show something more useful than "Shopify said no".
    this.operation = operation;
    this.fields = fields || [];
  }
}

export class ShopifyAuthError extends ShopifyApiError {
  constructor(message = 'Shopify rejected the access token') {
    super(message, { status: 401, code: 'unauthorized' });
    this.name = 'ShopifyAuthError';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt) {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return exponential / 2 + Math.random() * (exponential / 2);
}

/**
 * Creates a client bound to one shop's offline access token.
 * `shop` must already be a validated myshopify domain.
 */
export function createAdminClient({ shop, accessToken, log = logger }) {
  const { SHOPIFY_API_VERSION } = env();
  const endpoint = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const scoped = log.child ? log.child({ shop }) : log;

  async function request(query, variables = {}, options = {}) {
    const operation = options.operation || query.match(/(?:query|mutation)\s+(\w+)/)?.[1] || 'anonymous';
    let lastError;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const startedAt = Date.now();
      let response;
      try {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': accessToken,
            Accept: 'application/json',
          },
          body: JSON.stringify({ query, variables }),
          signal: options.signal,
        });
      } catch (networkError) {
        lastError = new ShopifyApiError(`Network error calling Shopify: ${networkError.message}`, {
          code: 'network_error',
          retryable: true,
        });
        await sleep(backoffDelay(attempt));
        continue;
      }

      const requestId = response.headers.get('x-request-id');

      if (response.status === 401 || response.status === 403) {
        throw new ShopifyAuthError(
          response.status === 403
            ? 'The app is missing a required Shopify permission'
            : 'Shopify rejected the access token'
        );
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('retry-after')) || 2;
        scoped.warn('shopify.rate_limited', { operation, retryAfterMs: retryAfter * 1000 });
        await sleep(retryAfter * 1000);
        lastError = new ShopifyApiError('Shopify rate limit reached', {
          status: 429,
          code: 'rate_limited',
          retryable: true,
        });
        continue;
      }

      if (response.status >= 500) {
        lastError = new ShopifyApiError(`Shopify returned ${response.status}`, {
          status: response.status,
          code: 'server_error',
          retryable: true,
          requestId,
        });
        await sleep(backoffDelay(attempt));
        continue;
      }

      let body;
      try {
        body = await response.json();
      } catch {
        throw new ShopifyApiError('Shopify returned a malformed response', {
          status: response.status,
          code: 'malformed_response',
          requestId,
        });
      }

      // GraphQL-level throttling arrives as a 200 with a THROTTLED error.
      const throttled = body.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled) {
        const cost = body.extensions?.cost;
        const waitMs = estimateThrottleWait(cost);
        scoped.warn('shopify.throttled', { operation, waitMs });
        await sleep(waitMs);
        lastError = new ShopifyApiError('Shopify GraphQL cost limit reached', {
          code: 'throttled',
          retryable: true,
          requestId,
        });
        continue;
      }

      if (body.errors?.length) {
        const message = body.errors.map((e) => e.message).join('; ');
        // The operation and the GraphQL path are what actually identify the
        // problem — without them a rejected variable is undiagnosable.
        scoped.warn('shopify.graphql_error', {
          operation,
          code: body.errors[0]?.extensions?.code,
          message,
          fields: body.errors.map((e) => (e.path || []).join('.')).filter(Boolean),
        });
        throw new ShopifyApiError(message, {
          status: response.status,
          code: body.errors[0]?.extensions?.code || 'graphql_error',
          requestId,
          operation,
          fields: body.errors.map((e) => (e.path || []).join('.')).filter(Boolean),
        });
      }

      scoped.debug('shopify.request', {
        operation,
        durationMs: Date.now() - startedAt,
        requestedCost: body.extensions?.cost?.requestedQueryCost,
        available: body.extensions?.cost?.throttleStatus?.currentlyAvailable,
      });

      return body.data;
    }

    throw lastError || new ShopifyApiError('Shopify request failed after retries', { code: 'exhausted' });
  }

  return { shop, endpoint, request };
}

function estimateThrottleWait(cost) {
  const status = cost?.throttleStatus;
  if (!status?.restoreRate) return 1000;
  const needed = (cost.requestedQueryCost || 50) - (status.currentlyAvailable || 0);
  if (needed <= 0) return 500;
  return Math.min(Math.ceil((needed / status.restoreRate) * 1000) + 250, MAX_DELAY_MS);
}

/**
 * Collects `userErrors` from a mutation payload into a single throwable.
 * Every mutation wrapper in services/shopify/* funnels through this so no
 * silent partial failure can slip past.
 */
export function assertNoUserErrors(payload, operation) {
  const userErrors = payload?.userErrors || payload?.mediaUserErrors || [];
  if (userErrors.length) {
    const message = userErrors.map((e) => `${(e.field || []).join('.')} ${e.message}`.trim()).join('; ');
    throw new ShopifyApiError(message || `${operation} failed`, {
      code: userErrors[0]?.code || 'user_error',
      userErrors,
      operation,
      fields: userErrors.map((e) => (e.field || []).join('.')).filter(Boolean),
    });
  }
  return payload;
}

/** Runs an async mapper over items in fixed-size batches. */
export async function inBatches(items, size, mapper) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(await mapper(batch, i / size));
  }
  return results;
}
