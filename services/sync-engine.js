import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { adminClientForShop } from '../lib/shopify/auth.js';
import { ShopifyApiError } from '../lib/shopify/client.js';
import { readRows } from './row-reader.js';
import { planRow, summarize } from './sync-planner.js';
import { toHandle } from './row-transformer.js';
import {
  findProductBySku,
  getProduct,
  createProduct,
  updateProduct,
  addProductMedia,
  createVariants,
  updateVariants,
  setInventoryQuantities,
  activateInventory,
  findCollectionByTitle,
  createCollection,
  addProductsToCollection,
  getShopContext,
} from './shopify-catalog.js';
import { describeError } from './error-center.js';
import { planLimits } from './billing.js';

/**
 * The sync engine.
 *
 * A job moves through two phases:
 *   PREVIEW — read the sheet, diff against Shopify, persist one SyncJobItem
 *             per row. Nothing is written to the store.
 *   SYNC    — replay the stored items and apply them.
 *
 * Both phases are resumable and idempotent: items are keyed by (job, row), and
 * applying an item marks it APPLIED so a re-run skips it.
 */

const ITEM_BATCH = 100;
const PROGRESS_INTERVAL = 25;

/**
 * Claims a queued job for this worker.
 *
 * The lock is taken with a conditional update, so two workers racing for the
 * same job produce exactly one winner — count 0 means someone else took it.
 * This is what enforces "never run two syncs for the same store at once".
 */
export async function claimJob(jobId, workerId) {
  const { count } = await prisma.syncJob.updateMany({
    where: { id: jobId, status: 'QUEUED', lockedAt: null },
    data: { status: 'RUNNING', lockedAt: new Date(), lockedBy: workerId, startedAt: new Date() },
  });
  if (count === 0) return null;

  return prisma.syncJob.findUnique({
    where: { id: jobId },
    include: {
      shop: true,
      dataSource: {
        include: {
          googleConnection: true,
          sheets: { where: { isSelected: true }, take: 1 },
          mappings: { where: { isIgnored: false } },
          rules: {
            where: { isEnabled: true },
            include: { priceRule: true, inventoryRule: true, collectionRule: true, tagRule: true },
          },
        },
      },
    },
  });
}

/** Releases a stale lock so a crashed worker's job can be retried. */
export async function releaseStaleJobs(olderThanMs = 30 * 60 * 1000) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const { count } = await prisma.syncJob.updateMany({
    where: { status: 'RUNNING', lockedAt: { lt: cutoff } },
    data: { status: 'QUEUED', lockedAt: null, lockedBy: null },
  });
  if (count) logger.warn('sync.stale_locks_released', { count });
  return count;
}

/**
 * Phase 1 — build the plan.
 * Returns the summary shown on the preview screen.
 */
export async function buildPlan(job, { workerId = 'inline' } = {}) {
  const log = logger.child({ jobId: job.id, shopId: job.shopId, phase: 'plan' });
  const source = job.dataSource;
  const sheet = source.sheets[0];

  if (!sheet) throw new Error('This source has no worksheet selected');
  if (source.kind === 'GOOGLE_SHEET' && !source.googleConnection) {
    throw new Error('This source is not connected to a Google account');
  }

  const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
  const mappings = source.mappings.map((m) => ({
    sourceColumn: m.sourceColumn,
    columnIndex: headers.indexOf(m.sourceColumn),
    targetField: m.targetField,
    isIgnored: m.isIgnored,
  }));

  const admin = await adminClientForShop(job.shop.domain, log);
  const { shop: shopInfo, primaryLocationId } = await getShopContext(admin);
  const currency = currencySymbol(shopInfo.currencyCode);

  if (primaryLocationId && primaryLocationId !== job.shop.primaryLocationId) {
    await prisma.shop.update({
      where: { id: job.shopId },
      data: { primaryLocationId, currencyCode: shopInfo.currencyCode, name: shopInfo.name },
    });
  }

  const limits = await planLimits(job.shopId);
  const existingMappings = await loadProductMappingCache(job.shopId);

  const settings = {
    allowBlankOverwrite: source.allowBlankOverwrite,
    allowStatusChange: source.allowStatusChange,
    allowImageUpdate: source.allowImageUpdate,
  };

  let processed = 0;
  let planned = [];
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  const seenSkus = new Set();

  for await (const row of readRows(source, sheet)) {
    if (await isCancelled(job.id)) break;

    let item;
    try {
      const existing = await resolveExisting({ admin, row, headers, mappings, existingMappings, log });
      item = planRow({ row, headers, mappings, rules: source.rules, existing, settings, currency });

      // A sheet that repeats a SKU would otherwise create the same product
      // twice within one run.
      if (item.sku && seenSkus.has(item.sku.toLowerCase())) {
        item = {
          ...item,
          action: 'ERROR',
          errors: [
            {
              field: 'variant.sku',
              message: `SKU ${item.sku} appears more than once in this sheet.`,
              suggestion: 'Remove the duplicate row, or give each variant its own SKU.',
            },
          ],
        };
      } else if (item.sku) {
        seenSkus.add(item.sku.toLowerCase());
      }
    } catch (error) {
      const described = describeError(error, { rowNumber: row.rowNumber });
      item = {
        rowNumber: row.rowNumber,
        rowHash: row.hash,
        sku: null,
        title: null,
        action: 'ERROR',
        changes: [],
        warnings: [],
        errors: [{ field: described.field, message: described.message, suggestion: described.suggestion }],
      };
    }

    if (item.action === 'CREATE' && limits.maxProducts != null) {
      const projected = existingMappings.size + counts.create + 1;
      if (projected > limits.maxProducts) {
        item = {
          ...item,
          action: 'ERROR',
          errors: [
            {
              field: 'plan',
              message: `Your ${limits.label} plan covers ${limits.maxProducts.toLocaleString()} products.`,
              suggestion: 'Upgrade your plan to sync the rest of this catalog.',
              kind: 'PLAN_LIMIT',
            },
          ],
        };
      }
    }

    planned.push(item);
    counts[item.action.toLowerCase()] = (counts[item.action.toLowerCase()] || 0) + 1;
    processed += 1;

    if (planned.length >= ITEM_BATCH) {
      await persistItems(job.id, planned);
      planned = [];
    }
    if (processed % PROGRESS_INTERVAL === 0) {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { processedRows: processed, totalRows: processed },
      });
    }
  }

  if (planned.length) await persistItems(job.id, planned);

  const items = await prisma.syncJobItem.findMany({
    where: { syncJobId: job.id },
    select: { action: true, warnings: true },
  });
  const summary = summarize(items.map((i) => ({ action: i.action, warnings: i.warnings })));

  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      totalRows: summary.total,
      processedRows: summary.total,
      createdCount: summary.create,
      updatedCount: summary.update,
      unchangedCount: summary.unchanged,
      failedCount: summary.error,
    },
  });

  log.info('sync.plan_built', { rows: summary.total, ...counts });
  return summary;
}

/**
 * Resolves the current Shopify state for a row.
 *
 * The persistent ProductMapping is consulted first — that is what stops the
 * engine creating a duplicate product when a merchant renames an item in the
 * sheet, and it keeps the Shopify lookup count proportional to *new* SKUs
 * rather than total rows.
 */
async function resolveExisting({ admin, row, headers, mappings, existingMappings, log }) {
  const skuMapping = mappings.find((m) => m.targetField === 'variant.sku');
  if (!skuMapping) return null;

  const index = headers.indexOf(skuMapping.sourceColumn);
  const sku = index >= 0 ? String(row.cells[index] ?? '').trim() : '';
  if (!sku) return null;

  const known = existingMappings.get(sku.toLowerCase());
  if (known) {
    try {
      const product = await getProduct(admin, known.shopifyProductId);
      if (product) {
        const variant =
          product.variants.nodes.find((v) => String(v.sku || '').toLowerCase() === sku.toLowerCase()) ||
          product.variants.nodes[0];
        return { product, variant };
      }
      // The product was deleted in Shopify — drop the stale mapping so the row
      // is treated as new rather than failing forever.
      await prisma.productMapping.deleteMany({ where: { id: known.id } });
      existingMappings.delete(sku.toLowerCase());
    } catch (error) {
      log.warn('sync.mapping_lookup_failed', { sku, error });
    }
  }

  const found = await findProductBySku(admin, sku);
  if (!found) return null;

  const product = await getProduct(admin, found.product.id);
  return { product, variant: found.variant };
}

async function loadProductMappingCache(shopId) {
  const rows = await prisma.productMapping.findMany({
    where: { shopId },
    select: { id: true, externalKey: true, shopifyProductId: true, lastRowHash: true },
  });
  return new Map(rows.map((r) => [r.externalKey.toLowerCase(), r]));
}

async function persistItems(jobId, items) {
  await prisma.syncJobItem.createMany({
    data: items.map((item) => ({
      syncJobId: jobId,
      rowNumber: item.rowNumber,
      rowHash: item.rowHash,
      sku: item.sku,
      handle: item.handle || null,
      title: item.title,
      action: item.action,
      status: 'PENDING',
      changes: item.changes || [],
      warnings: item.warnings || [],
      shopifyProductId: item.shopifyProductId || null,
      shopifyVariantId: item.shopifyVariantId || null,
    })),
    skipDuplicates: true,
  });

  const errorRows = items.filter((i) => i.errors?.length);
  if (errorRows.length) {
    await prisma.syncError.createMany({
      data: errorRows.flatMap((item) =>
        item.errors.map((error) => ({
          syncJobId: jobId,
          kind: error.kind || 'VALIDATION',
          message: error.message,
          suggestion: error.suggestion || null,
          field: error.field || null,
          sku: item.sku,
          rowNumber: item.rowNumber,
          productTitle: item.title,
          isRetryable: false,
        }))
      ),
    });
  }
}

/**
 * Phase 2 — apply the plan.
 * Only items the merchant approved (PENDING, CREATE/UPDATE) are applied.
 */
export async function applyPlan(job, { workerId = 'inline', onlyItemIds = null } = {}) {
  const log = logger.child({ jobId: job.id, shopId: job.shopId, phase: 'apply' });
  const source = job.dataSource;
  const sheet = source.sheets[0];
  const headers = Array.isArray(sheet?.headers) ? sheet.headers : [];

  const admin = await adminClientForShop(job.shop.domain, log);
  const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
  let locationId = shop.primaryLocationId;
  if (!locationId) {
    ({ primaryLocationId: locationId } = await getShopContext(admin));
  }

  const mappings = source.mappings.map((m) => ({
    sourceColumn: m.sourceColumn,
    columnIndex: headers.indexOf(m.sourceColumn),
    targetField: m.targetField,
    isIgnored: m.isIgnored,
  }));

  const collectionCache = await loadCollectionCache(job.shopId);
  const settings = {
    allowBlankOverwrite: source.allowBlankOverwrite,
    allowStatusChange: source.allowStatusChange,
    allowImageUpdate: source.allowImageUpdate,
  };

  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };

  // The pending items are loaded once, keyed by row number, then the source is
  // streamed a single time. Reading the sheet per batch instead would rescan it
  // from the top for every 25 products, which turns a 2,000 row sync into
  // eighty full passes over the spreadsheet.
  const pendingItems = await prisma.syncJobItem.findMany({
    where: {
      syncJobId: job.id,
      status: 'PENDING',
      action: { in: ['CREATE', 'UPDATE'] },
      ...(onlyItemIds ? { id: { in: onlyItemIds } } : {}),
    },
    select: {
      id: true,
      rowNumber: true,
      sku: true,
      title: true,
      action: true,
      shopifyProductId: true,
    },
  });

  if (pendingItems.length === 0) {
    log.info('sync.nothing_to_apply', {});
    return counts;
  }

  const itemsByRow = new Map(pendingItems.map((item) => [item.rowNumber, item]));
  const seenRows = new Set();

  // Rows are re-read from the source so the apply step works from the same
  // data the plan did, and re-planned so a store edit made since the preview
  // is respected rather than blindly overwritten.
  {
    for await (const row of readRows(source, sheet)) {
      if (await isCancelled(job.id)) break;

      const item = itemsByRow.get(row.rowNumber);
      if (!item) continue;
      seenRows.add(row.rowNumber);

      try {
        const existing = await resolveExistingForApply(admin, item, row, headers, mappings, log);
        const plan = planRow({
          row,
          headers,
          mappings,
          rules: source.rules,
          existing,
          settings,
          currency: currencySymbol(shop.currencyCode),
        });

        if (plan.action === 'UNCHANGED') {
          await markSkipped(item.id, 'Already up to date.');
          counts.skipped += 1;
          continue;
        }
        if (plan.action === 'ERROR') {
          await recordItemError(job.id, item, plan.errors[0]);
          counts.failed += 1;
          continue;
        }

        const result =
          plan.action === 'CREATE'
            ? await applyCreate({ admin, plan, job, source, locationId, collectionCache, log })
            : await applyUpdate({ admin, plan, job, source, locationId, collectionCache, log });

        await prisma.syncJobItem.update({
          where: { id: item.id },
          data: {
            status: 'APPLIED',
            appliedAt: new Date(),
            shopifyProductId: result.productId,
            shopifyVariantId: result.variantId,
            changes: plan.changes,
          },
        });

        if (plan.action === 'CREATE') counts.created += 1;
        else counts.updated += 1;
      } catch (error) {
        const described = describeError(error, { sku: item.sku, rowNumber: item.rowNumber });
        await recordItemError(job.id, item, described);
        counts.failed += 1;
        log.warn('sync.item_failed', { rowNumber: item.rowNumber, sku: item.sku, error });
      }

      await prisma.syncJob.update({
        where: { id: job.id },
        data: { processedRows: { increment: 1 } },
      });
    }
  }

  // Anything the stream never reached was deleted from the sheet between the
  // preview and now. Skipping is the safe outcome: the product stays as it is.
  for (const item of pendingItems) {
    if (seenRows.has(item.rowNumber)) continue;
    await markSkipped(item.id, 'That row is no longer in the source.');
    counts.skipped += 1;
  }

  await prisma.syncJob.update({
    where: { id: job.id },
    data: {
      createdCount: counts.created,
      updatedCount: counts.updated,
      skippedCount: counts.skipped,
      failedCount: counts.failed,
    },
  });

  log.info('sync.applied', counts);
  return counts;
}

async function resolveExistingForApply(admin, item, row, headers, mappings, log) {
  if (item.shopifyProductId) {
    try {
      const product = await getProduct(admin, item.shopifyProductId);
      if (product) {
        const variant =
          product.variants.nodes.find(
            (v) => String(v.sku || '').toLowerCase() === String(item.sku || '').toLowerCase()
          ) || product.variants.nodes[0];
        return { product, variant };
      }
    } catch (error) {
      log.warn('sync.apply_lookup_failed', { sku: item.sku, error });
    }
  }
  if (!item.sku) return null;
  const found = await findProductBySku(admin, item.sku);
  if (!found) return null;
  const product = await getProduct(admin, found.product.id);
  return { product, variant: found.variant };
}

// ------------------------------------------------------------------ create

async function applyCreate({ admin, plan, job, source, locationId, collectionCache, log }) {
  const fields = plan.fields;
  const options = plan.options;

  const productInput = {
    title: fields['product.title'],
    handle: plan.handle || toHandle(fields['product.title']),
    status: fields['product.status'] || 'DRAFT',
  };
  if (fields['product.descriptionHtml']) productInput.descriptionHtml = fields['product.descriptionHtml'];
  if (fields['product.vendor']) productInput.vendor = fields['product.vendor'];
  if (fields['product.productType']) productInput.productType = fields['product.productType'];
  if (fields['product.tags']?.length) productInput.tags = fields['product.tags'];
  if (fields['product.seoTitle'] || fields['product.seoDescription']) {
    productInput.seo = {
      title: fields['product.seoTitle'] || undefined,
      description: fields['product.seoDescription'] || undefined,
    };
  }

  const media = plan.images.map((url) => ({
    originalSource: url,
    mediaContentType: 'IMAGE',
  }));

  const product = await createProduct(admin, {
    product: productInput,
    media,
    options: options.length
      ? options.map((opt) => ({ name: opt.name, values: [opt.value] }))
      : null,
  });

  // The product comes back with one default variant; update it in place rather
  // than creating a second one.
  const defaultVariant = product.variants?.nodes?.[0];
  const variantInput = buildVariantInput(fields, options);

  let variantId = defaultVariant?.id;
  let inventoryItemId = defaultVariant?.inventoryItem?.id;

  if (defaultVariant) {
    const [updated] = await updateVariants(admin, product.id, [{ id: defaultVariant.id, ...variantInput }]);
    variantId = updated?.id || variantId;
    inventoryItemId = updated?.inventoryItem?.id || inventoryItemId;
  } else {
    const [created] = await createVariants(admin, product.id, [variantInput]);
    variantId = created?.id;
    inventoryItemId = created?.inventoryItem?.id;
  }

  await applyInventory({ admin, locationId, inventoryItemId, fields, activate: true, log });
  await applyCollections({ admin, plan, job, collectionCache, productId: product.id, log });

  const productMapping = await prisma.productMapping.upsert({
    where: { shopId_externalKey: { shopId: job.shopId, externalKey: plan.sku } },
    create: {
      shopId: job.shopId,
      dataSourceId: source.id,
      externalKey: plan.sku,
      shopifyProductId: product.id,
      handle: product.handle,
      lastRowHash: plan.rowHash,
      lastSyncedAt: new Date(),
    },
    update: {
      shopifyProductId: product.id,
      handle: product.handle,
      lastRowHash: plan.rowHash,
      lastSyncedAt: new Date(),
    },
  });

  if (variantId) {
    await prisma.variantMapping.upsert({
      where: { shopId_sku: { shopId: job.shopId, sku: plan.sku } },
      create: {
        shopId: job.shopId,
        productMappingId: productMapping.id,
        sku: plan.sku,
        shopifyVariantId: variantId,
        inventoryItemId: inventoryItemId || null,
        lastRowHash: plan.rowHash,
        lastSyncedAt: new Date(),
      },
      update: {
        shopifyVariantId: variantId,
        inventoryItemId: inventoryItemId || null,
        lastRowHash: plan.rowHash,
        lastSyncedAt: new Date(),
      },
    });
  }

  return { productId: product.id, variantId };
}

// ------------------------------------------------------------------ update

async function applyUpdate({ admin, plan, job, source, locationId, collectionCache, log }) {
  const changed = new Set(plan.changes.map((c) => c.field));
  const fields = plan.fields;
  const productId = plan.shopifyProductId;

  const productInput = { id: productId };
  let touchesProduct = false;

  const productFieldMap = {
    'product.title': 'title',
    'product.descriptionHtml': 'descriptionHtml',
    'product.vendor': 'vendor',
    'product.productType': 'productType',
    'product.status': 'status',
  };

  for (const [key, input] of Object.entries(productFieldMap)) {
    if (!changed.has(key)) continue;
    const change = plan.changes.find((c) => c.field === key);
    productInput[input] = change.action === 'clear' ? '' : fields[key];
    touchesProduct = true;
  }
  if (changed.has('product.tags')) {
    productInput.tags = fields['product.tags'] || [];
    touchesProduct = true;
  }
  if (changed.has('product.seoTitle') || changed.has('product.seoDescription')) {
    productInput.seo = {
      title: fields['product.seoTitle'] ?? undefined,
      description: fields['product.seoDescription'] ?? undefined,
    };
    touchesProduct = true;
  }

  if (touchesProduct) await updateProduct(admin, productInput);

  // Variants are updated by id — never replaced — so unmapped variants of the
  // same product are left exactly as they are.
  const variantFields = ['variant.price', 'variant.compareAtPrice', 'variant.barcode', 'variant.cost', 'variant.weight'];
  if (plan.shopifyVariantId && variantFields.some((f) => changed.has(f))) {
    const input = buildVariantInput(fields, plan.options, changed);
    await updateVariants(admin, productId, [{ id: plan.shopifyVariantId, ...input }]);
  }

  if (changed.has('variant.inventoryQuantity')) {
    await applyInventory({
      admin,
      locationId,
      inventoryItemId: plan.inventoryItemId,
      fields,
      activate: false,
      log,
    });
  }

  if (changed.has('media') && plan.images.length) {
    try {
      await addProductMedia(
        admin,
        productId,
        plan.images.map((url) => ({ originalSource: url, mediaContentType: 'IMAGE' }))
      );
    } catch (error) {
      // An unreachable image is reported but must not roll back a price update.
      const described = describeError(error, { sku: plan.sku, rowNumber: plan.rowNumber });
      await prisma.syncError.create({
        data: {
          syncJobId: job.id,
          kind: 'IMAGE',
          message: described.message,
          suggestion: described.suggestion,
          field: 'media',
          sku: plan.sku,
          rowNumber: plan.rowNumber,
          productTitle: plan.title,
          isRetryable: true,
        },
      });
    }
  }

  if (changed.has('collections')) {
    await applyCollections({ admin, plan, job, collectionCache, productId, log });
  }

  await prisma.productMapping.upsert({
    where: { shopId_externalKey: { shopId: job.shopId, externalKey: plan.sku } },
    create: {
      shopId: job.shopId,
      dataSourceId: source.id,
      externalKey: plan.sku,
      shopifyProductId: productId,
      handle: plan.handle,
      lastRowHash: plan.rowHash,
      lastSyncedAt: new Date(),
    },
    update: { lastRowHash: plan.rowHash, lastSyncedAt: new Date(), shopifyProductId: productId },
  });

  return { productId, variantId: plan.shopifyVariantId };
}

function buildVariantInput(fields, options, changed = null) {
  const input = {};
  const wants = (key) => (changed ? changed.has(key) : fields[key] != null);

  if (wants('variant.price') && fields['variant.price'] != null) {
    input.price = String(fields['variant.price']);
  }
  if (wants('variant.compareAtPrice') && fields['variant.compareAtPrice'] != null) {
    input.compareAtPrice = String(fields['variant.compareAtPrice']);
  }
  if (wants('variant.barcode') && fields['variant.barcode'] != null) {
    input.barcode = String(fields['variant.barcode']);
  }

  const inventoryItem = {};
  if (fields['variant.sku'] != null && !changed) inventoryItem.sku = String(fields['variant.sku']);
  if (wants('variant.cost') && fields['variant.cost'] != null) {
    inventoryItem.cost = String(fields['variant.cost']);
  }
  if (wants('variant.weight') && fields['variant.weight'] != null) {
    inventoryItem.measurement = {
      weight: {
        value: Number(fields['variant.weight']),
        unit: fields['variant.weightUnit'] || 'KILOGRAMS',
      },
    };
  }
  if (fields['variant.inventoryQuantity'] != null && !changed) inventoryItem.tracked = true;
  if (Object.keys(inventoryItem).length) input.inventoryItem = inventoryItem;

  if (!changed && options?.length) {
    input.optionValues = options.map((opt) => ({ optionName: opt.name, name: opt.value }));
  }

  return input;
}

async function applyInventory({ admin, locationId, inventoryItemId, fields, activate, log }) {
  const quantity = fields['variant.inventoryQuantity'];
  if (quantity == null || !inventoryItemId || !locationId) return;

  try {
    if (activate) {
      await activateInventory({ admin, inventoryItemId, locationId, available: Math.max(0, quantity) });
      return;
    }
    await setInventoryQuantities(admin, {
      locationId,
      quantities: [{ inventoryItemId, quantity }],
    });
  } catch (error) {
    // An item that was never stocked at this location has to be activated first.
    if (error instanceof ShopifyApiError && /not stocked|inventory item/i.test(error.message)) {
      await activateInventory({ admin, inventoryItemId, locationId, available: Math.max(0, quantity) });
      return;
    }
    log.warn('sync.inventory_failed', { error });
    throw error;
  }
}

async function applyCollections({ admin, plan, job, collectionCache, productId, log }) {
  for (const title of plan.collections || []) {
    const key = title.toLowerCase();
    let collectionId = collectionCache.get(key);

    if (!collectionId) {
      const found = await findCollectionByTitle(admin, title);
      if (found) {
        collectionId = found.id;
      } else if (plan.createIfMissingCollections) {
        const created = await createCollection(admin, title);
        collectionId = created.id;
        await prisma.collectionMapping.upsert({
          where: { shopId_sourceValue: { shopId: job.shopId, sourceValue: title } },
          create: {
            shopId: job.shopId,
            sourceValue: title,
            shopifyCollectionId: created.id,
            title: created.title,
            createdByApp: true,
          },
          update: { shopifyCollectionId: created.id, title: created.title },
        });
      } else {
        // Creating collections is opt-in; without it, a missing collection is
        // surfaced rather than silently invented.
        await prisma.syncError.create({
          data: {
            syncJobId: job.id,
            kind: 'MAPPING',
            message: `The collection "${title}" does not exist in your store.`,
            suggestion: 'Create it in Shopify, or turn on "Create missing collections" in the collection rule.',
            field: 'collections',
            sku: plan.sku,
            rowNumber: plan.rowNumber,
            productTitle: plan.title,
            isRetryable: true,
          },
        });
        continue;
      }
      collectionCache.set(key, collectionId);
    }

    await addProductsToCollection(admin, collectionId, [productId]);
  }
}

async function loadCollectionCache(shopId) {
  const rows = await prisma.collectionMapping.findMany({
    where: { shopId },
    select: { sourceValue: true, shopifyCollectionId: true },
  });
  return new Map(rows.map((r) => [r.sourceValue.toLowerCase(), r.shopifyCollectionId]));
}

// ------------------------------------------------------------- completion

async function markSkipped(itemId, reason) {
  await prisma.syncJobItem.update({
    where: { id: itemId },
    data: { status: 'SKIPPED', warnings: [{ message: reason }] },
  });
}

async function recordItemError(jobId, item, described) {
  await prisma.$transaction([
    prisma.syncJobItem.update({ where: { id: item.id }, data: { status: 'FAILED' } }),
    prisma.syncError.create({
      data: {
        syncJobId: jobId,
        syncJobItemId: item.id,
        kind: described.kind || 'UNKNOWN',
        code: described.code || null,
        message: described.message,
        suggestion: described.suggestion || null,
        field: described.field || null,
        sku: item.sku,
        rowNumber: item.rowNumber,
        productTitle: item.title,
        isRetryable: described.isRetryable ?? true,
      },
    }),
  ]);
}

async function isCancelled(jobId) {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { cancelRequested: true },
  });
  return Boolean(job?.cancelRequested);
}

/** Finalizes a job and writes its history row. */
export async function completeJob(jobId, { status } = {}) {
  const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job) return null;

  const finishedAt = new Date();
  const startedAt = job.startedAt || job.createdAt;
  const finalStatus =
    status || (job.failedCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED');

  const updated = await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: finalStatus, finishedAt, lockedAt: null, lockedBy: null },
  });

  if (job.kind === 'SYNC') {
    await prisma.syncHistory.upsert({
      where: { syncJobId: jobId },
      create: {
        shopId: job.shopId,
        dataSourceId: job.dataSourceId,
        syncJobId: jobId,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        scanned: job.totalRows,
        created: job.createdCount,
        updated: job.updatedCount,
        unchanged: job.unchangedCount,
        skipped: job.skippedCount,
        failed: job.failedCount,
        status: finalStatus,
        triggeredBy: job.triggeredBy,
      },
      update: {},
    });

    await prisma.dataSource.update({
      where: { id: job.dataSourceId },
      data: { lastRunAt: finishedAt },
    });
  }

  return updated;
}

function currencySymbol(code) {
  const symbols = { USD: '$', EUR: '€', GBP: '£', INR: '₹', CAD: 'CA$', AUD: 'A$', JPY: '¥' };
  return symbols[code] || '';
}
