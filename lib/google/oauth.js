import { google } from 'googleapis';
import prisma from '../prisma.js';
import { env } from '../env.js';
import { encrypt, decrypt } from '../crypto.js';
import { logger } from '../logger.js';

/**
 * Google OAuth.
 *
 * Scopes are the narrowest set that supports the product: read/write on files
 * the app is given access to, plus readonly metadata so the picker can list a
 * merchant's spreadsheets. `drive.readonly` is deliberately not requested.
 */

/**
 * Whether merchants may connect by signing in with Google.
 *
 * Off by default. The OAuth implementation is complete, but `spreadsheets` is
 * a sensitive scope, so until Google verifies the app the consent screen only
 * admits manually approved testers — showing the option would lead every
 * merchant to "Access blocked". Set GOOGLE_OAUTH_ENABLED=true once
 * verification is granted.
 */
export function googleOAuthEnabled() {
  return process.env.GOOGLE_OAUTH_ENABLED === 'true';
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
];

export class GoogleAuthError extends Error {
  constructor(message, { code = 'google_auth_error', needsReconnect = false } = {}) {
    super(message);
    this.name = 'GoogleAuthError';
    this.code = code;
    this.needsReconnect = needsReconnect;
  }
}

export function oauthClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env();
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/**
 * Builds the consent URL.
 * `state` is an HMAC-signed token produced by lib/crypto.signState, which is
 * what ties the callback back to a shop without trusting a query parameter.
 */
export function buildConsentUrl(state) {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even on re-consent
    scope: GOOGLE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

/** Exchanges the authorization code and stores the connection for a shop. */
export async function completeConnection({ code, shopId, userId }) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new GoogleAuthError('Google did not return an access token');
  }

  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const { data: profile } = await oauth2.userinfo.get();

  if (!profile.id || !profile.email) {
    throw new GoogleAuthError('Google did not return an account identity');
  }

  const existing = await prisma.googleConnection.findUnique({
    where: { shopId_googleUserId: { shopId, googleUserId: profile.id } },
  });

  // Google only returns a refresh token on first consent; keep the stored one
  // when a re-consent omits it.
  const refreshToken = tokens.refresh_token
    ? encrypt(tokens.refresh_token)
    : existing?.refreshToken ?? null;

  const data = {
    email: profile.email,
    accessToken: encrypt(tokens.access_token),
    refreshToken,
    scope: tokens.scope || GOOGLE_SCOPES.join(' '),
    expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    isRevoked: false,
    lastCheckedAt: new Date(),
    userId: userId || null,
  };

  const connection = await prisma.googleConnection.upsert({
    where: { shopId_googleUserId: { shopId, googleUserId: profile.id } },
    create: { shopId, googleUserId: profile.id, ...data },
    update: data,
  });

  logger.info('google.connected', { shopId, connectionId: connection.id });
  return connection;
}

/**
 * Returns an authorized Google client for a stored connection, refreshing the
 * access token when it is close to expiry.
 *
 * A revoked grant is recorded on the connection so the UI can show a reconnect
 * prompt instead of failing every sync silently.
 */
export async function authorizedClient(connection) {
  if (connection.isRevoked) {
    throw new GoogleAuthError('This Google account is no longer connected', {
      code: 'google_revoked',
      needsReconnect: true,
    });
  }

  const client = oauthClient();
  client.setCredentials({
    access_token: decrypt(connection.accessToken),
    refresh_token: connection.refreshToken ? decrypt(connection.refreshToken) : undefined,
    expiry_date: connection.expiresAt ? connection.expiresAt.getTime() : undefined,
  });

  const expiresSoon =
    !connection.expiresAt || connection.expiresAt.getTime() - Date.now() < 60_000;

  if (expiresSoon) {
    if (!connection.refreshToken) {
      await markRevoked(connection.id);
      throw new GoogleAuthError('Your Google connection expired and needs to be renewed', {
        code: 'google_expired',
        needsReconnect: true,
      });
    }
    try {
      const { credentials } = await client.refreshAccessToken();
      await prisma.googleConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: encrypt(credentials.access_token),
          expiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
          lastCheckedAt: new Date(),
          isRevoked: false,
        },
      });
      client.setCredentials(credentials);
    } catch (error) {
      const revoked = ['invalid_grant', 'unauthorized_client'].includes(error?.response?.data?.error);
      if (revoked) {
        await markRevoked(connection.id);
        throw new GoogleAuthError('Access to your Google account was revoked', {
          code: 'google_revoked',
          needsReconnect: true,
        });
      }
      throw new GoogleAuthError(`Could not refresh Google access: ${error.message}`);
    }
  }

  return client;
}

async function markRevoked(connectionId) {
  await prisma.googleConnection.update({
    where: { id: connectionId },
    data: { isRevoked: true, lastCheckedAt: new Date() },
  });
}

/** Maps a googleapis error into a merchant-facing GoogleAuthError. */
export function translateGoogleError(error) {
  const status = error?.code || error?.response?.status;
  if (status === 401) {
    return new GoogleAuthError('Your Google connection needs to be renewed', {
      code: 'google_expired',
      needsReconnect: true,
    });
  }
  if (status === 403) {
    return new GoogleAuthError(
      'Google denied access to this spreadsheet. Check that the connected account can open it.',
      { code: 'google_forbidden' }
    );
  }
  if (status === 404) {
    return new GoogleAuthError('That spreadsheet no longer exists or was moved', {
      code: 'google_not_found',
    });
  }
  if (status === 429) {
    return new GoogleAuthError('Google is rate limiting requests. Try again in a moment.', {
      code: 'google_rate_limited',
    });
  }
  return new GoogleAuthError(error?.message || 'Google Sheets request failed');
}
