import './setup-env.js';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAdminClient, ShopifyApiError, ShopifyAuthError } from '../lib/shopify/client.js';

/**
 * Retry behaviour decides whether a large sync survives a rate limit, so it is
 * tested against a scripted fetch rather than a live store.
 */

const originalFetch = global.fetch;

function scriptFetch(responses) {
  let index = 0;
  const calls = [];
  global.fetch = vi.fn(async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: response.status < 400,
      status: response.status ?? 200,
      headers: new Headers(response.headers || {}),
      json: async () => response.body ?? {},
      text: async () => JSON.stringify(response.body ?? {}),
    };
  });
  return { calls, count: () => index };
}

const client = () =>
  createAdminClient({
    shop: 'test-store.myshopify.com',
    accessToken: 'shpat_test',
    log: { child: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }) },
  });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = originalFetch;
});

describe('createAdminClient', () => {
  it('returns data on success', async () => {
    scriptFetch([{ status: 200, body: { data: { shop: { name: 'Test' } } } }]);
    const data = await client().request('query GetShop { shop { name } }');
    expect(data.shop.name).toBe('Test');
  });

  it('sends the access token as a header, not in the body', async () => {
    const script = scriptFetch([{ status: 200, body: { data: {} } }]);
    await client().request('query X { a }');
    expect(JSON.stringify(script.calls[0].body)).not.toContain('shpat_test');
  });

  it('raises an auth error on 401 without retrying', async () => {
    const script = scriptFetch([{ status: 401, body: {} }]);
    await expect(client().request('query X { a }')).rejects.toThrow(ShopifyAuthError);
    expect(script.count()).toBe(1);
  });

  it('treats 403 as a missing permission', async () => {
    scriptFetch([{ status: 403, body: {} }]);
    await expect(client().request('query X { a }')).rejects.toThrow(/missing a required Shopify permission/);
  });

  it('retries a 500 and then succeeds', async () => {
    const script = scriptFetch([
      { status: 500, body: {} },
      { status: 200, body: { data: { ok: true } } },
    ]);

    const promise = client().request('query X { a }');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(script.count()).toBe(2);
  });

  it('backs off and retries a GraphQL THROTTLED response', async () => {
    const script = scriptFetch([
      {
        status: 200,
        body: {
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: { requestedQueryCost: 100, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } },
          },
        },
      },
      { status: 200, body: { data: { ok: true } } },
    ]);

    const promise = client().request('query X { a }');
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(script.count()).toBe(2);
  });

  it('honours Retry-After on a 429', async () => {
    const script = scriptFetch([
      { status: 429, headers: { 'retry-after': '1' }, body: {} },
      { status: 200, body: { data: { ok: true } } },
    ]);

    const promise = client().request('query X { a }');
    await vi.advanceTimersByTimeAsync(2000);
    await expect(promise).resolves.toEqual({ ok: true });
    expect(script.count()).toBe(2);
  });

  it('gives up after repeated failures instead of looping forever', async () => {
    scriptFetch([{ status: 500, body: {} }]);
    const promise = client().request('query X { a }');
    const assertion = expect(promise).rejects.toThrow(ShopifyApiError);
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
  });

  it('surfaces a GraphQL error without retrying it', async () => {
    const script = scriptFetch([
      { status: 200, body: { errors: [{ message: 'Field does not exist' }] } },
    ]);
    await expect(client().request('query X { a }')).rejects.toThrow(/Field does not exist/);
    expect(script.count()).toBe(1);
  });

  it('reports a malformed response clearly', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new Error('not json');
      },
    }));
    await expect(client().request('query X { a }')).rejects.toThrow(/malformed response/);
  });
});
