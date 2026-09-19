'use client';

/**
 * Browser-side API client.
 *
 * Every request carries a fresh App Bridge session token. Tokens are short
 * lived by design, so one is fetched per call rather than cached — and a 401
 * carrying Shopify's retry header is retried once with a new token, which is
 * what keeps a long-open tab from breaking after the token expires.
 */

export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function sessionToken() {
  if (typeof window === 'undefined') return null;
  // shopify.idToken() is provided by app-bridge.js once it has loaded.
  if (typeof window.shopify?.idToken === 'function') {
    return window.shopify.idToken();
  }
  return null;
}

/**
 * Whether a body should be serialized as JSON.
 *
 * Only a plain object qualifies. A FormData, Blob or stream must be handed to
 * fetch untouched: JSON.stringify(formData) is `{}`, which silently discards
 * the file, and setting a JSON content-type overrides the multipart boundary
 * the browser generates, so the server cannot parse what does arrive.
 */
function isJsonBody(body) {
  if (body == null || typeof body === 'string') return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return false;
  if (typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body))) {
    return false;
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return false;
  return true;
}

export async function apiFetch(path, options = {}, { retry = true } = {}) {
  const token = await sessionToken();
  const jsonBody = isJsonBody(options.body);

  const headers = {
    Accept: 'application/json',
    ...(jsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const response = await fetch(path, {
    ...options,
    headers,
    body: jsonBody ? JSON.stringify(options.body) : options.body,
  });

  if (response.status === 401 && retry && response.headers.get('X-Shopify-Retry-Invalid-Session-Request')) {
    return apiFetch(path, options, { retry: false });
  }

  if (response.status === 204) return null;

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error || {};
    throw new ApiError(error.message || `Request failed with status ${response.status}`, {
      status: response.status,
      code: error.code,
      details: error.details,
    });
  }

  return payload;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body) => apiFetch(path, { method: 'POST', body }),
  put: (path, body) => apiFetch(path, { method: 'PUT', body }),
  patch: (path, body) => apiFetch(path, { method: 'PATCH', body }),
  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};

/** Formats a money value using the shop's currency. */
export function formatMoney(value, currency = 'USD') {
  if (value == null || value === '') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(number);
  } catch {
    return number.toFixed(2);
  }
}

export function formatNumber(value) {
  if (value == null) return '—';
  return Number(value).toLocaleString();
}

export function formatDate(value, options = { dateStyle: 'medium' }) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
  } catch {
    return String(value);
  }
}

export function formatDuration(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatRelative(value) {
  if (!value) return 'never';
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(value);
}
