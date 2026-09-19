import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch } from '../lib/client-api.js';

/**
 * How a request body is sent.
 *
 * This regressed once already: every body was JSON.stringify'd and given a
 * JSON content-type, which turned an uploaded file into `{}` and stripped the
 * multipart boundary the server needs. File upload could not work at all.
 */

const originalFetch = global.fetch;
let lastCall;

beforeEach(() => {
  lastCall = null;
  global.fetch = vi.fn(async (path, init) => {
    lastCall = { path, init };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ ok: true }),
    };
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('apiFetch — file uploads', () => {
  it('sends FormData untouched', async () => {
    const form = new FormData();
    form.append('file', new Blob(['Title,SKU\nShirt,S1']), 'supplier.csv');

    await apiFetch('/api/sources/files', { method: 'POST', body: form });

    expect(lastCall.init.body).toBe(form);
    expect(lastCall.init.body).toBeInstanceOf(FormData);
  });

  it('does not set a JSON content-type for FormData', async () => {
    // The browser must set multipart/form-data with its own boundary; any
    // Content-Type we set here replaces it and the upload becomes unparseable.
    await apiFetch('/api/sources/files', { method: 'POST', body: new FormData() });
    expect(lastCall.init.headers['Content-Type']).toBeUndefined();
  });

  it('keeps the file readable after passing through', async () => {
    const form = new FormData();
    form.append('file', new Blob(['Title,SKU\nShirt,S1']), 'supplier.csv');

    await apiFetch('/api/sources/files', { method: 'POST', body: form });

    const sent = lastCall.init.body.get('file');
    expect(await sent.text()).toBe('Title,SKU\nShirt,S1');
  });
});

describe('apiFetch — JSON bodies', () => {
  it('serializes a plain object and sets the JSON content-type', async () => {
    await apiFetch('/api/rules', { method: 'POST', body: { name: 'Markup', priority: 100 } });

    expect(lastCall.init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(lastCall.init.body)).toEqual({ name: 'Markup', priority: 100 });
  });

  it('serializes an array', async () => {
    await apiFetch('/api/x', { method: 'POST', body: [1, 2] });
    expect(lastCall.init.body).toBe('[1,2]');
  });

  it('passes a string body through unchanged', async () => {
    await apiFetch('/api/x', { method: 'POST', body: '{"already":"json"}' });
    expect(lastCall.init.body).toBe('{"already":"json"}');
  });

  it('sets no content-type when there is no body', async () => {
    await apiFetch('/api/dashboard');
    expect(lastCall.init.headers['Content-Type']).toBeUndefined();
  });

  it('leaves URLSearchParams alone', async () => {
    const params = new URLSearchParams({ a: '1' });
    await apiFetch('/api/x', { method: 'POST', body: params });
    expect(lastCall.init.body).toBe(params);
  });

  it('leaves binary bodies alone', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await apiFetch('/api/x', { method: 'POST', body: bytes });
    expect(lastCall.init.body).toBe(bytes);
  });
});
