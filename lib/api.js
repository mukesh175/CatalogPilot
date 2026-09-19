import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { authenticateAdmin, ReauthRequiredError } from './shopify/auth.js';
import { SessionTokenError } from './shopify/sessionToken.js';
import { ShopifyApiError, ShopifyAuthError } from './shopify/client.js';

/**
 * Route helpers.
 *
 * `withAuth` is the only way an API route gets a shop identity. It rejects the
 * request before the handler runs if the session token is absent or invalid,
 * so no handler ever has to decide whether a caller is trustworthy.
 */

export function json(data, init = {}) {
  return NextResponse.json(data, {
    ...init,
    headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}

export function apiError(message, { status = 400, code = 'bad_request', details } = {}) {
  return json({ error: { code, message, details } }, { status });
}

/**
 * Wraps a route handler with Shopify session-token authentication.
 *
 *   export const GET = withAuth(async (request, ctx) => { ... });
 *
 * `ctx` carries { shop, shopId, admin, userId, log, params }.
 */
export function withAuth(handler) {
  return async function authedRoute(request, routeContext) {
    const started = Date.now();
    let auth;
    try {
      auth = await authenticateAdmin(request);
    } catch (error) {
      if (error instanceof SessionTokenError) {
        // 401 + this header tells App Bridge to fetch a fresh token and retry.
        return json(
          { error: { code: error.code, message: 'Your session expired. Reloading…' } },
          { status: 401, headers: { 'X-Shopify-Retry-Invalid-Session-Request': '1' } }
        );
      }
      if (error instanceof ReauthRequiredError) {
        return json(
          { error: { code: 'reauth_required', message: error.message, shop: error.shop } },
          { status: 403 }
        );
      }
      logger.error('api.auth_failed', { error });
      return apiError('Unable to verify your Shopify session', {
        status: 401,
        code: 'unauthenticated',
      });
    }

    const params = routeContext?.params ? await routeContext.params : {};

    try {
      const response = await handler(request, { ...auth, params });
      auth.log.info('api.request', {
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      return handleRouteError(error, auth.log, request);
    }
  };
}

/** Wraps an unauthenticated route (OAuth callbacks, health) with error handling. */
export function withErrorHandling(handler) {
  return async function route(request, routeContext) {
    try {
      const params = routeContext?.params ? await routeContext.params : {};
      return await handler(request, { params });
    } catch (error) {
      return handleRouteError(error, logger, request);
    }
  };
}

function handleRouteError(error, log, request) {
  const path = new URL(request.url).pathname;

  if (error instanceof ZodError) {
    return apiError('Some of the submitted values are not valid', {
      status: 422,
      code: 'validation_failed',
      details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }

  if (error instanceof ShopifyAuthError) {
    return apiError('Shopify rejected our access to your store. Please reconnect the app.', {
      status: 403,
      code: 'shopify_unauthorized',
    });
  }

  if (error instanceof ShopifyApiError) {
    log.warn('api.shopify_error', { path, error, code: error.code });
    return apiError(error.message, { status: 502, code: error.code || 'shopify_error' });
  }

  if (error?.code === 'P2002') {
    return apiError('That record already exists.', { status: 409, code: 'duplicate' });
  }
  if (error?.code === 'P2025') {
    return apiError('That record could not be found.', { status: 404, code: 'not_found' });
  }

  log.error('api.unhandled_error', { path, error, stack: error?.stack });
  return apiError('Something went wrong on our side. The issue has been logged.', {
    status: 500,
    code: 'internal_error',
  });
}

/** Parses and validates a JSON body against a Zod schema. */
export async function parseBody(request, schema) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw new ZodError([{ code: 'custom', path: ['body'], message: 'Expected a JSON body' }]);
  }
  return schema.parse(body);
}

/** Parses query params against a Zod schema. */
export function parseQuery(request, schema) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  return schema.parse(params);
}
