import dns from 'node:dns/promises';
import net from 'node:net';
import Papa from 'papaparse';
import { hashRow } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { dedupeHeaders } from './google-sheets.js';
import { MAX_ROWS, MAX_UPLOAD_BYTES, FileImportError } from './file-source.js';

/**
 * Sources read from a published CSV link.
 *
 * Google Sheets can publish a worksheet as CSV at a stable URL, which the
 * server can fetch on a schedule with no credentials at all — no consent
 * screen, so no app verification. The cost is that the link is readable by
 * anyone who has it, which the UI states plainly before the merchant commits.
 */

const FETCH_TIMEOUT_MS = 30_000;

/**
 * Validates a URL the merchant supplied before the server fetches it.
 *
 * The server is about to make a request to an address a user chose, which is
 * the classic SSRF shape: without this, a crafted URL could be pointed at
 * cloud metadata endpoints or private services the server can reach and we
 * cannot.
 */
export async function assertFetchableUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new FileImportError('That is not a valid link.', 'Paste the full URL, starting with https://');
  }

  if (url.protocol !== 'https:') {
    throw new FileImportError('The link must use https.', 'Copy the published link again from Google Sheets.');
  }

  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new FileImportError('That link points at a private address.', 'Use a publicly reachable link.');
  }

  // A literal private IP, and then the resolved address, because a public host
  // name can still resolve to a private one.
  const addresses = net.isIP(host) ? [host] : await resolveHost(host);
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new FileImportError(
        'That link points at a private address.',
        'Use a publicly reachable link, such as a Google Sheets published CSV link.'
      );
    }
  }

  return url;
}

async function resolveHost(host) {
  try {
    const records = await dns.lookup(host, { all: true });
    return records.map((record) => record.address);
  } catch {
    throw new FileImportError(
      `Could not find the server at ${host}.`,
      'Check the link, or try again in a moment.'
    );
  }
}

function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }

  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4-mapped IPv6 hides a private v4 address inside a v6 one.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

/** Downloads and parses the CSV at a published link. */
export async function fetchCsvUrl(rawUrl) {
  const url = await assertFetchableUrl(rawUrl);

  let response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/csv,text/plain,*/*' },
    });
  } catch (error) {
    throw new FileImportError(
      'Could not download the file at that link.',
      error?.name === 'TimeoutError'
        ? 'The server took too long to respond. Try again, or use a smaller sheet.'
        : 'Check that the link opens in a browser without signing in.'
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new FileImportError(
      'That link is not publicly readable.',
      'In Google Sheets use File → Share → Publish to web, choose CSV, and paste that link.'
    );
  }
  if (response.status === 404) {
    throw new FileImportError('Nothing was found at that link.', 'Check the link and try again.');
  }
  if (!response.ok) {
    throw new FileImportError(
      `The server returned ${response.status} for that link.`,
      'Check that the link is still published.'
    );
  }

  // A published Google Sheet that has been unshared returns an HTML sign-in
  // page with a 200, so the content type has to be checked too.
  const contentType = response.headers.get('content-type') || '';
  if (/text\/html/i.test(contentType)) {
    throw new FileImportError(
      'That link returned a web page, not a CSV file.',
      'In Google Sheets use File → Share → Publish to web and choose Comma-separated values (.csv).'
    );
  }

  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_UPLOAD_BYTES) {
    throw new FileImportError('That file is larger than 20MB.', 'Split the sheet into smaller files.');
  }

  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_UPLOAD_BYTES) {
    throw new FileImportError('That file is larger than 20MB.', 'Split the sheet into smaller files.');
  }

  return parseCsvText(text);
}

/** Parses CSV text into the same row shape every other source produces. */
export function parseCsvText(text) {
  const parsed = Papa.parse(String(text).replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });

  if (!parsed.data?.length) {
    throw new FileImportError('That file has no rows.', 'Check the sheet has a header row and some data.');
  }

  const headers = dedupeHeaders((parsed.data[0] || []).map((h) => String(h ?? '').trim()));
  if (headers.length === 0) {
    throw new FileImportError(
      'The first row has no column names.',
      'Put your column headings in the first row of the sheet.'
    );
  }

  const rows = parsed.data
    .slice(1, MAX_ROWS + 1)
    .map((cells, index) => {
      const padded = Array.from({ length: headers.length }, (_, i) => {
        const cell = cells?.[i];
        return cell == null ? '' : String(cell).trim();
      });
      if (padded.every((cell) => cell === '')) return null;
      return { rowNumber: index + 2, cells: padded, hash: hashRow(padded) };
    })
    .filter(Boolean);

  logger.info('url_source.parsed', { headers: headers.length, rows: rows.length });
  return { headers, rows, worksheetName: 'Published CSV' };
}
