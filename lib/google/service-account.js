import { google } from 'googleapis';
import { logger } from '../logger.js';

/**
 * Service-account access to Google Sheets.
 *
 * This path exists to avoid the OAuth consent screen entirely. A service
 * account is an identity the app owns, so there is no consent, no app
 * verification, no 100-user cap and no seven-day refresh token expiry. The
 * trade is that it can only open files that were explicitly shared with its
 * address — which is also the privacy benefit: the merchant shares one sheet
 * with one address, not their whole Drive.
 */

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

export class ServiceAccountError extends Error {
  constructor(message, { code = 'service_account_error', suggestion = null } = {}) {
    super(message);
    this.name = 'ServiceAccountError';
    this.code = code;
    this.suggestion = suggestion;
  }
}

/** The address merchants must share their sheet with. Safe to show in the UI. */
export function serviceAccountEmail() {
  return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || null;
}

export function serviceAccountConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
}

/**
 * Reads the private key from the environment.
 *
 * Accepts either the raw PEM (with literal \n, as pasted into a dashboard) or
 * the whole service-account JSON base64-encoded, because both are what people
 * actually end up with.
 */
function privateKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new ServiceAccountError('CatalogPilot is not configured for shared sheets.', {
      code: 'service_account_missing',
      suggestion: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY.',
    });
  }

  const value = raw.trim();

  if (value.includes('BEGIN PRIVATE KEY')) {
    // A dashboard turns a real newline into the two characters \n.
    return value.replace(/\\n/g, '\n');
  }

  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    if (parsed.private_key) return parsed.private_key.replace(/\\n/g, '\n');
  } catch {
    // Fall through to the error below.
  }

  throw new ServiceAccountError('The service account key is not in a recognised format.', {
    code: 'service_account_key_invalid',
    suggestion: 'Paste the private_key PEM, or the whole service account JSON base64-encoded.',
  });
}

/** An authorized client for reading shared sheets. */
export function serviceAccountClient() {
  const email = serviceAccountEmail();
  if (!email) {
    throw new ServiceAccountError('CatalogPilot is not configured for shared sheets.', {
      code: 'service_account_missing',
      suggestion: 'Set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY.',
    });
  }

  return new google.auth.JWT({ email, key: privateKey(), scopes: SCOPES });
}

/**
 * Extracts the spreadsheet id from whatever the merchant pasted.
 * Accepts a full edit URL, a share URL, or a bare id.
 */
export function parseSpreadsheetId(input) {
  const value = String(input || '').trim();
  if (!value) return null;

  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromUrl) return fromUrl[1];

  // A bare id: Google's are long and use this alphabet.
  if (/^[a-zA-Z0-9-_]{20,}$/.test(value)) return value;

  return null;
}

/**
 * Turns a Sheets API failure into something the merchant can act on.
 * A 403 here almost always means they have not shared the sheet yet.
 */
export function translateServiceAccountError(error, email) {
  const status = error?.code || error?.response?.status;

  if (status === 403) {
    return new ServiceAccountError('CatalogPilot cannot open that spreadsheet yet.', {
      code: 'sheet_not_shared',
      suggestion: `Open the sheet in Google Sheets, click Share, and give ${email || 'the service account address'} Viewer access.`,
    });
  }
  if (status === 404) {
    return new ServiceAccountError('No spreadsheet was found at that link.', {
      code: 'sheet_not_found',
      suggestion: 'Check the link, and that the sheet has not been deleted or moved to the trash.',
    });
  }
  if (status === 429) {
    return new ServiceAccountError('Google is rate limiting requests right now.', {
      code: 'google_rate_limited',
      suggestion: 'Try again in a minute.',
    });
  }

  logger.warn('service_account.unmapped_error', { status, error });
  return new ServiceAccountError(error?.message || 'Could not read that spreadsheet.', {
    code: 'service_account_error',
  });
}
