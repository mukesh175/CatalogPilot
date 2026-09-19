import prisma from '../prisma.js';
import { env } from '../env.js';
import { encrypt, decrypt } from '../crypto.js';
import { logger } from '../logger.js';
import { createAdminClient, ShopifyAuthError } from './client.js';
import {
  extractSessionToken,
  verifySessionToken,
  SessionTokenError,
  isValidShopDomain,
} from './sessionToken.js';

/**
 * Shopify authentication.
 *
 * Embedded requests authenticate with an App Bridge session token, which is
 * exchanged for an access token the first time we see a given shop (token
 * exchange — Shopify's current recommendation, paired with managed install).
 * The offline token is what background jobs use; the online token carries the
 * acting staff member so per-user Google connections can be attributed.
 */

const OFFLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:offline-access-token';
const ONLINE_TOKEN_TYPE = 'urn:shopify:params:oauth:token-type:online-access-token';

export const offlineSessionId = (shop) => `offline_${shop}`;
export const onlineSessionId = (shop, userId) => `online_${shop}_${userId}`;

export class ReauthRequiredError extends Error {
  constructor(shop, message = 'The app needs to be reauthorized') {
    super(message);
    this.name = 'ReauthRequiredError';
    this.code = 'reauth_required';
    this.shop = shop;
  }
}

/**
 * Exchanges a verified session token for an access token.
 * Returns the raw Shopify payload; callers persist it via storeSession.
 */
export async function exchangeToken({ shop, sessionToken, online = false }) {
  if (!isValidShopDomain(shop)) throw new ShopifyAuthError('Invalid shop domain');
  const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET } = env();

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: online ? ONLINE_TOKEN_TYPE : OFFLINE_TOKEN_TYPE,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    logger.warn('shopify.token_exchange_failed', { shop, status: response.status });
    if (response.status === 400 && detail.includes('invalid_subject_token')) {
      throw new SessionTokenError('Session token expired during exchange', 'expired_session_token');
    }
    throw new ShopifyAuthError(`Token exchange failed with status ${response.status}`);
  }

  return response.json();
}

/** Upserts the Shop row, creating default billing/notification records. */
export async function ensureShop(domain) {
  const existing = await prisma.shop.findUnique({ where: { domain } });
  if (existing) {
    if (!existing.isActive) {
      return prisma.shop.update({
        where: { id: existing.id },
        data: { isActive: true, uninstalledAt: null },
      });
    }
    return existing;
  }

  return prisma.shop.create({
    data: {
      domain,
      subscription: { create: { plan: 'FREE', status: 'ACTIVE' } },
      notification: { create: {} },
    },
  });
}

/** Persists an access token, encrypted. */
export async function storeSession({ shop, payload, online, userId }) {
  const shopRecord = await ensureShop(shop);
  const associatedUser = payload.associated_user;
  const resolvedUserId = online ? String(associatedUser?.id ?? userId ?? '') : null;
  const sessionId = online ? onlineSessionId(shop, resolvedUserId) : offlineSessionId(shop);

  const data = {
    shopId: shopRecord.id,
    isOnline: Boolean(online),
    scope: payload.scope || null,
    accessToken: encrypt(payload.access_token),
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
    onlineUserId: resolvedUserId || null,
  };

  await prisma.shopifySession.upsert({
    where: { sessionId },
    create: { sessionId, ...data },
    update: data,
  });

  if (online && associatedUser) {
    await prisma.user.upsert({
      where: { shopId_shopifyUserId: { shopId: shopRecord.id, shopifyUserId: resolvedUserId } },
      create: {
        shopId: shopRecord.id,
        shopifyUserId: resolvedUserId,
        email: associatedUser.email || null,
        firstName: associatedUser.first_name || null,
        lastName: associatedUser.last_name || null,
        locale: associatedUser.locale || null,
        isOwner: Boolean(associatedUser.account_owner),
      },
      update: {
        email: associatedUser.email || null,
        firstName: associatedUser.first_name || null,
        lastName: associatedUser.last_name || null,
        isOwner: Boolean(associatedUser.account_owner),
        lastSeenAt: new Date(),
      },
    });
  }

  logger.info('shopify.session_stored', { shop, online: Boolean(online) });
  return { shop: shopRecord, sessionId };
}

/**
 * Loads the offline session for a shop. Background jobs use this — there is no
 * request context, so the shop id must come from a trusted caller.
 */
export async function loadOfflineSession(shopDomain) {
  const session = await prisma.shopifySession.findUnique({
    where: { sessionId: offlineSessionId(shopDomain) },
    include: { shop: true },
  });
  if (!session) throw new ReauthRequiredError(shopDomain, 'No stored Shopify session for this shop');
  return session;
}

/** Admin GraphQL client for a shop, using the stored offline token. */
export async function adminClientForShop(shopDomain, log = logger) {
  const session = await loadOfflineSession(shopDomain);
  return createAdminClient({
    shop: shopDomain,
    accessToken: decrypt(session.accessToken),
    log,
  });
}

/**
 * Authenticates an embedded admin request.
 *
 * Returns { shop, shopRecord, sessionToken, userId, admin } where `admin` is a
 * ready-to-use Admin GraphQL client. Never accepts a shop from the client;
 * identity always comes from the verified session token.
 */
export async function authenticateAdmin(request) {
  const token = extractSessionToken(request);
  const { shop, userId } = await verifySessionToken(token);

  let session = await prisma.shopifySession.findUnique({
    where: { sessionId: offlineSessionId(shop) },
    include: { shop: true },
  });

  // First request from a newly installed shop, or a shop whose token we lost.
  if (!session) {
    const payload = await exchangeToken({ shop, sessionToken: token, online: false });
    await storeSession({ shop, payload, online: false });
    session = await prisma.shopifySession.findUnique({
      where: { sessionId: offlineSessionId(shop) },
      include: { shop: true },
    });
  }

  // Scope drift means the app was updated and needs reauthorization.
  const requiredScopes = env().SHOPIFY_SCOPES.split(',').map((s) => s.trim()).filter(Boolean);
  const grantedScopes = new Set((session.scope || '').split(',').map((s) => s.trim()));
  const missingScopes = requiredScopes.filter((s) => !grantedScopes.has(s));

  if (session.shop.uninstalledAt && !session.shop.isActive) {
    throw new ReauthRequiredError(shop, 'The app was uninstalled from this store');
  }

  const log = logger.child({ shop, shopId: session.shopId });
  const admin = createAdminClient({ shop, accessToken: decrypt(session.accessToken), log });

  if (userId) {
    await touchUser(session.shopId, userId);
  }

  return {
    shop,
    shopId: session.shopId,
    shopRecord: session.shop,
    sessionToken: token,
    userId,
    missingScopes,
    admin,
    log,
  };
}

async function touchUser(shopId, shopifyUserId) {
  await prisma.user
    .upsert({
      where: { shopId_shopifyUserId: { shopId, shopifyUserId } },
      create: { shopId, shopifyUserId },
      update: { lastSeenAt: new Date() },
    })
    .catch(() => {
      // A failed presence update must never block the request.
    });
}

/** Marks a shop uninstalled and clears its stored credentials. */
export async function handleUninstall(shopDomain) {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return null;

  await prisma.$transaction([
    prisma.shopifySession.deleteMany({ where: { shopId: shop.id } }),
    prisma.dataSource.updateMany({
      where: { shopId: shop.id },
      data: { isPaused: true, nextRunAt: null },
    }),
    prisma.shop.update({
      where: { id: shop.id },
      data: { isActive: false, uninstalledAt: new Date() },
    }),
  ]);

  logger.info('shopify.uninstalled', { shop: shopDomain, shopId: shop.id });
  return shop;
}
