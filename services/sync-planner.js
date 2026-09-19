import { fieldLabel } from '../lib/fields.js';
import {
  applyPriceRules,
  applyInventoryRules,
  applyTagRules,
  applyCollectionRules,
  applyOverrideRules,
  RuleError,
} from './rules-engine.js';
import { transformRow, validateRow, imageUrls, optionPairs, isBlank, toHandle } from './row-transformer.js';

/**
 * The planner turns one source row into a decision: create, update, leave
 * alone, or flag. It is pure — no network, no database — which is what makes
 * the preview screen trustworthy: the same function produces the preview and
 * drives the apply step, so what the merchant approves is what runs.
 */

/**
 * Field-by-field comparison rules.
 *
 * SAFETY: a mapped field is only written when the source actually has a value.
 * A blank cell never clears a Shopify field unless the merchant turned on
 * `allowBlankOverwrite` for the source.
 */
export function planRow({
  row,
  headers,
  mappings,
  rules,
  existing,
  settings = {},
  currency = '',
}) {
  const { allowBlankOverwrite = false, allowStatusChange = true, allowImageUpdate = true } = settings;

  const { fields, warnings } = transformRow({ cells: row.cells, mappings, headers });
  const errors = validateRow(fields);

  if (errors.length) {
    return {
      rowNumber: row.rowNumber,
      rowHash: row.hash,
      sku: fields['variant.sku'] ? String(fields['variant.sku']) : null,
      title: fields['product.title'] ? String(fields['product.title']) : null,
      action: 'ERROR',
      changes: [],
      warnings,
      errors,
      fields,
    };
  }

  const sku = String(fields['variant.sku']);
  const title = String(fields['product.title']);

  // Rule evaluation. A broken rule is a row-level error rather than a crash —
  // one product with a non-numeric cost should not abort a 2,000 row sync.
  let priceResult = null;
  let compareAtResult = null;
  let inventoryResult = null;
  let tagResult = null;
  let collectionResult = null;
  let vendorResult = null;
  let statusResult = null;

  try {
    const ruleInput = { ...fields };
    const priced = applyPriceRules(rules, ruleInput, { currency });
    if (priced?.field === 'variant.compareAtPrice') compareAtResult = priced;
    else priceResult = priced;

    inventoryResult = applyInventoryRules(rules, ruleInput, {
      supplierQuantity: fields['variant.inventoryQuantity'],
    });
    tagResult = applyTagRules(rules, ruleInput, { existingTags: existing?.product?.tags || [] });
    collectionResult = applyCollectionRules(rules, ruleInput);
    vendorResult = applyOverrideRules(rules, ruleInput, 'VENDOR');
    statusResult = applyOverrideRules(rules, ruleInput, 'STATUS');
  } catch (error) {
    if (error instanceof RuleError) {
      return {
        rowNumber: row.rowNumber,
        rowHash: row.hash,
        sku,
        title,
        action: 'ERROR',
        changes: [],
        warnings,
        errors: [
          {
            field: error.field || 'rule',
            message: `A rule could not be applied: ${error.message}`,
            suggestion: 'Check the rule formula and the source columns it depends on.',
          },
        ],
        fields,
      };
    }
    throw error;
  }

  // Rule outputs override raw sheet values.
  const desired = { ...fields };
  if (priceResult) desired['variant.price'] = priceResult.value;
  if (compareAtResult) desired['variant.compareAtPrice'] = compareAtResult.value;
  if (inventoryResult) desired['variant.inventoryQuantity'] = inventoryResult.quantity;
  if (tagResult) desired['product.tags'] = tagResult.tags;
  if (vendorResult) desired['product.vendor'] = vendorResult.value;
  if (statusResult) desired['product.status'] = statusResult.value;
  else if (inventoryResult?.status) desired['product.status'] = inventoryResult.status;

  const explanations = new Map();
  if (priceResult) explanations.set('variant.price', priceResult.explanation);
  if (compareAtResult) explanations.set('variant.compareAtPrice', compareAtResult.explanation);
  if (inventoryResult) explanations.set('variant.inventoryQuantity', inventoryResult.explanation);
  if (tagResult) explanations.set('product.tags', tagResult.explanation);
  if (vendorResult) explanations.set('product.vendor', vendorResult.explanation);
  if (statusResult) explanations.set('product.status', statusResult.explanation);
  else if (inventoryResult?.status) explanations.set('product.status', inventoryResult.explanation);

  const images = allowImageUpdate ? imageUrls(desired) : [];
  const options = optionPairs(desired);
  const collections = collectionResult?.titles || [];

  // ---- New product -------------------------------------------------------
  if (!existing) {
    const changes = COMPARABLE_FIELDS.filter((key) => desired[key] != null).map((key) => ({
      field: key,
      label: fieldLabel(key),
      current: null,
      incoming: desired[key],
      explanation: explanations.get(key) || null,
      action: 'set',
    }));

    if (images.length) {
      changes.push({
        field: 'media',
        label: 'Images',
        current: null,
        incoming: images,
        explanation: null,
        action: 'set',
      });
    }
    if (collections.length) {
      changes.push({
        field: 'collections',
        label: 'Collections',
        current: null,
        incoming: collections,
        explanation: collectionResult.explanation,
        action: 'set',
      });
    }

    return {
      rowNumber: row.rowNumber,
      rowHash: row.hash,
      sku,
      title,
      handle: toHandle(title),
      action: 'CREATE',
      changes,
      warnings,
      errors: [],
      fields: desired,
      images,
      options,
      collections,
      createIfMissingCollections: Boolean(collectionResult?.createIfMissing),
    };
  }

  // ---- Existing product --------------------------------------------------
  const current = currentValues(existing);
  const changes = [];

  for (const key of COMPARABLE_FIELDS) {
    if (key === 'product.status' && !allowStatusChange) continue;

    const incoming = desired[key];
    const mappedButBlank = isMapped(mappings, key) && incoming == null;

    if (mappedButBlank) {
      // A blank source cell only clears a field when explicitly permitted.
      if (!allowBlankOverwrite) continue;
      if (current[key] == null || current[key] === '') continue;
      changes.push({
        field: key,
        label: fieldLabel(key),
        current: current[key],
        incoming: null,
        explanation: {
          rule: 'Blank values overwrite',
          condition: 'Enabled for this source',
          steps: ['Source cell is empty'],
          result: 'cleared',
        },
        action: 'clear',
      });
      continue;
    }

    if (incoming == null) continue;
    if (valuesEqual(current[key], incoming)) continue;

    changes.push({
      field: key,
      label: fieldLabel(key),
      current: current[key] ?? null,
      incoming,
      explanation: explanations.get(key) || null,
      action: 'update',
    });
  }

  if (images.length && !imagesEqual(existing.product?.media, images)) {
    changes.push({
      field: 'media',
      label: 'Images',
      current: (existing.product?.media?.nodes || []).map((n) => n.image?.url).filter(Boolean),
      incoming: images,
      explanation: null,
      action: 'append',
    });
  }

  const missingCollections = collections.filter(
    (titleValue) =>
      !(existing.product?.collections?.nodes || []).some(
        (c) => c.title.toLowerCase() === titleValue.toLowerCase()
      )
  );
  if (missingCollections.length) {
    changes.push({
      field: 'collections',
      label: 'Collections',
      current: (existing.product?.collections?.nodes || []).map((c) => c.title),
      incoming: missingCollections,
      explanation: collectionResult?.explanation || null,
      action: 'append',
    });
  }

  return {
    rowNumber: row.rowNumber,
    rowHash: row.hash,
    sku,
    title,
    handle: existing.product?.handle || toHandle(title),
    action: changes.length ? 'UPDATE' : 'UNCHANGED',
    changes,
    warnings,
    errors: [],
    fields: desired,
    images,
    options,
    collections: missingCollections,
    createIfMissingCollections: Boolean(collectionResult?.createIfMissing),
    shopifyProductId: existing.product?.id || null,
    shopifyVariantId: existing.variant?.id || null,
    inventoryItemId: existing.variant?.inventoryItem?.id || null,
  };
}

/** Fields compared between sheet and store, in the order shown in the preview. */
const COMPARABLE_FIELDS = [
  'product.title',
  'product.descriptionHtml',
  'product.vendor',
  'product.productType',
  'product.status',
  'product.tags',
  'product.seoTitle',
  'product.seoDescription',
  'variant.sku',
  'variant.barcode',
  'variant.price',
  'variant.compareAtPrice',
  'variant.cost',
  'variant.inventoryQuantity',
  'variant.weight',
];

function isMapped(mappings, targetField) {
  return mappings.some((m) => m.targetField === targetField && !m.isIgnored);
}

/** Flattens the Shopify product/variant pair into the planner's field keys. */
export function currentValues(existing) {
  const product = existing.product || {};
  const variant = existing.variant || {};
  return {
    'product.title': product.title ?? null,
    'product.descriptionHtml': product.descriptionHtml ?? null,
    'product.vendor': product.vendor ?? null,
    'product.productType': product.productType ?? null,
    'product.status': product.status ?? null,
    'product.tags': product.tags ?? [],
    'product.handle': product.handle ?? null,
    'product.seoTitle': product.seo?.title ?? null,
    'product.seoDescription': product.seo?.description ?? null,
    'variant.sku': variant.sku ?? null,
    'variant.barcode': variant.barcode ?? null,
    'variant.price': variant.price != null ? Number(variant.price) : null,
    'variant.compareAtPrice': variant.compareAtPrice != null ? Number(variant.compareAtPrice) : null,
    'variant.cost':
      variant.inventoryItem?.unitCost?.amount != null
        ? Number(variant.inventoryItem.unitCost.amount)
        : null,
    'variant.inventoryQuantity': variant.inventoryQuantity ?? null,
    'variant.weight': variant.inventoryItem?.measurement?.weight?.value ?? null,
  };
}

/** Comparison that tolerates the type drift between Shopify and sheet data. */
export function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    const listA = (Array.isArray(a) ? a : [a]).map((v) => String(v).trim().toLowerCase()).sort();
    const listB = (Array.isArray(b) ? b : [b]).map((v) => String(v).trim().toLowerCase()).sort();
    return listA.length === listB.length && listA.every((v, i) => v === listB[i]);
  }

  if (typeof a === 'number' || typeof b === 'number') {
    const numA = Number(a);
    const numB = Number(b);
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      // Money arrives as "2500.00" from Shopify and 2500 from a sheet.
      return Math.abs(numA - numB) < 0.005;
    }
  }

  return String(a).trim() === String(b).trim();
}

function imagesEqual(media, incoming) {
  const existingUrls = (media?.nodes || []).map((n) => n.image?.url).filter(Boolean);
  if (existingUrls.length === 0) return incoming.length === 0;
  // Images are appended, never replaced, so "equal" means every incoming URL is
  // already attached.
  return incoming.every((url) => existingUrls.some((existing) => sameImage(existing, url)));
}

function sameImage(a, b) {
  const strip = (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    } catch {
      return String(url).toLowerCase();
    }
  };
  return strip(a) === strip(b);
}

/** Aggregates planned rows into the counts shown on the preview screen. */
export function summarize(items) {
  const summary = { total: items.length, create: 0, update: 0, unchanged: 0, error: 0, warnings: 0 };
  for (const item of items) {
    if (item.action === 'CREATE') summary.create += 1;
    else if (item.action === 'UPDATE') summary.update += 1;
    else if (item.action === 'ERROR') summary.error += 1;
    else summary.unchanged += 1;
    if (item.warnings?.length) summary.warnings += 1;
  }
  return summary;
}
