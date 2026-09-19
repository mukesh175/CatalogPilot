import { authorizedClient } from '../lib/google/oauth.js';
import {
  serviceAccountClient,
  translateServiceAccountError,
  serviceAccountEmail,
  ServiceAccountError,
} from '../lib/google/service-account.js';
import { GoogleAuthError } from '../lib/google/oauth.js';

/**
 * Resolves which Google credentials a source reads with.
 *
 * Two paths exist because Google app verification is a weeks-long process that
 * a merchant-facing app cannot launch without. The service-account path skips
 * the consent screen entirely, so it works today; the OAuth path stays for
 * merchants who prefer picking a sheet straight from their Drive, once the app
 * is verified.
 */

export async function authForSource(source) {
  if (source.kind === 'GOOGLE_SHEET_SERVICE') return serviceAccountClient();

  if (source.kind === 'GOOGLE_SHEET') {
    if (!source.googleConnection) {
      throw new GoogleAuthError('This source is not connected to a Google account', {
        code: 'google_not_connected',
        needsReconnect: true,
      });
    }
    return authorizedClient(source.googleConnection);
  }

  throw new Error(`Source kind ${source.kind} does not read from Google`);
}

/** Maps an error to the right merchant-facing wording for the source's path. */
export function translateSheetError(error, source) {
  if (source?.kind === 'GOOGLE_SHEET_SERVICE') {
    if (error instanceof ServiceAccountError) return error;
    return translateServiceAccountError(error, serviceAccountEmail());
  }
  return error;
}

export { serviceAccountEmail, serviceAccountConfigured } from '../lib/google/service-account.js';
