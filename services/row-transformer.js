import { TARGET_FIELD_MAP } from '../lib/fields.js';
import { toNumber } from './rules-engine.js';

/**
 * Turns a raw sheet row into a typed, validated field object keyed by Shopify
 * target field.
 *
 * Validation is separated from coercion on purpose: a cell that cannot be read
 * as the declared type produces a warning attached to that field rather than
 * throwing, so one bad weight does not discard an otherwise good product.
 */

const VALID_STATUSES = new Set(['ACTIVE', 'DRAFT', 'ARCHIVED']);
const WEIGHT_UNITS = new Set(['GRAMS', 'KILOGRAMS', 'OUNCES', 'POUNDS']);

const STATUS_ALIASES = new Map([
  ['active', 'ACTIVE'],
  ['published', 'ACTIVE'],
  ['live', 'ACTIVE'],
  ['yes', 'ACTIVE'],
  ['true', 'ACTIVE'],
  ['1', 'ACTIVE'],
  ['in stock', 'ACTIVE'],
  ['draft', 'DRAFT'],
  ['unpublished', 'DRAFT'],
  ['no', 'DRAFT'],
  ['false', 'DRAFT'],
  ['0', 'DRAFT'],
  ['hidden', 'DRAFT'],
  ['archived', 'ARCHIVED'],
  ['discontinued', 'ARCHIVED'],
]);

const WEIGHT_UNIT_ALIASES = new Map([
  ['g', 'GRAMS'],
  ['gram', 'GRAMS'],
  ['grams', 'GRAMS'],
  ['kg', 'KILOGRAMS'],
  ['kgs', 'KILOGRAMS'],
  ['kilogram', 'KILOGRAMS'],
  ['kilograms', 'KILOGRAMS'],
  ['oz', 'OUNCES'],
  ['ounce', 'OUNCES'],
  ['ounces', 'OUNCES'],
  ['lb', 'POUNDS'],
  ['lbs', 'POUNDS'],
  ['pound', 'POUNDS'],
  ['pounds', 'POUNDS'],
]);

export function isBlank(value) {
  return value == null || String(value).trim() === '';
}

/**
 * Maps a row's cells onto target fields using the confirmed column mappings.
 * Returns { fields, warnings } where `fields` omits blank cells entirely —
 * an absent key means "supplier said nothing", which is different from "".
 */
export function transformRow({ cells, mappings, headers }) {
  const fields = {};
  const warnings = [];
  const headerIndex = new Map(headers.map((h, i) => [h, i]));

  for (const mapping of mappings) {
    if (mapping.isIgnored || !mapping.targetField) continue;

    const index = headerIndex.has(mapping.sourceColumn)
      ? headerIndex.get(mapping.sourceColumn)
      : mapping.columnIndex;
    if (index == null || index < 0) continue;

    const raw = cells[index];
    if (isBlank(raw)) continue;

    const target = TARGET_FIELD_MAP.get(mapping.targetField);
    const { value, warning } = coerce(raw, target?.type || 'string', mapping.targetField);

    if (warning) {
      warnings.push({ field: mapping.targetField, column: mapping.sourceColumn, message: warning });
      continue;
    }
    fields[mapping.targetField] = value;
  }

  return { fields, warnings };
}

function coerce(raw, type, fieldKey) {
  const text = typeof raw === 'string' ? raw.trim() : raw;

  switch (type) {
    case 'money': {
      const num = toNumber(text);
      if (num == null) return { warning: `"${raw}" is not a valid amount` };
      if (num < 0) return { warning: `"${raw}" is a negative amount` };
      return { value: Math.round(num * 100) / 100 };
    }
    case 'integer': {
      const num = toNumber(text);
      if (num == null) return { warning: `"${raw}" is not a whole number` };
      return { value: Math.round(num) };
    }
    case 'number': {
      const num = toNumber(text);
      if (num == null) return { warning: `"${raw}" is not a number` };
      return { value: num };
    }
    case 'list': {
      const items = String(text)
        .split(/[,;|]/)
        .map((v) => v.trim())
        .filter(Boolean);
      return { value: items };
    }
    case 'url': {
      const url = String(text);
      if (!/^https?:\/\/\S+$/i.test(url)) {
        return { warning: `"${truncate(url)}" is not a valid image URL` };
      }
      return { value: url };
    }
    case 'enum': {
      if (fieldKey === 'product.status') {
        const normalized = String(text).trim().toLowerCase();
        const status = STATUS_ALIASES.get(normalized) || String(text).trim().toUpperCase();
        if (!VALID_STATUSES.has(status)) {
          return { warning: `"${raw}" is not a recognised product status` };
        }
        return { value: status };
      }
      if (fieldKey === 'variant.weightUnit') {
        const normalized = String(text).trim().toLowerCase();
        const unit = WEIGHT_UNIT_ALIASES.get(normalized) || String(text).trim().toUpperCase();
        if (!WEIGHT_UNITS.has(unit)) return { warning: `"${raw}" is not a recognised weight unit` };
        return { value: unit };
      }
      return { value: String(text) };
    }
    case 'html':
      return { value: String(text) };
    default:
      return { value: String(text) };
  }
}

function truncate(value, length = 60) {
  const str = String(value);
  return str.length > length ? `${str.slice(0, length)}…` : str;
}

/**
 * Row-level validation that must pass before a row can be synced at all.
 * Returns a list of errors; an empty list means the row is usable.
 */
export function validateRow(fields) {
  const errors = [];

  const sku = fields['variant.sku'];
  if (isBlank(sku)) {
    errors.push({
      field: 'variant.sku',
      message: 'This row has no SKU, so it cannot be matched to a product.',
      suggestion: 'Add a SKU in the source sheet, or map a different column to SKU.',
    });
  } else if (String(sku).length > 255) {
    errors.push({
      field: 'variant.sku',
      message: 'This SKU is longer than Shopify allows (255 characters).',
      suggestion: 'Shorten the SKU in the source sheet.',
    });
  }

  const title = fields['product.title'];
  if (isBlank(title)) {
    errors.push({
      field: 'product.title',
      message: 'This row has no product title.',
      suggestion: 'Add a title in the source sheet, or map a different column to Title.',
    });
  }

  const price = fields['variant.price'];
  if (price != null && price > 99_999_999) {
    errors.push({
      field: 'variant.price',
      message: 'This price is above the maximum Shopify accepts.',
      suggestion: 'Check the price column for a formatting mistake.',
    });
  }

  const compareAt = fields['variant.compareAtPrice'];
  if (price != null && compareAt != null && compareAt > 0 && compareAt < price) {
    errors.push({
      field: 'variant.compareAtPrice',
      message: 'The compare-at price is lower than the selling price.',
      suggestion: 'Shopify shows this as a price increase. Swap the two columns if they are reversed.',
    });
  }

  return errors;
}

/** Collects the ordered image URLs present on a row. */
export function imageUrls(fields) {
  return ['media.image1', 'media.image2', 'media.image3', 'media.image4']
    .map((key) => fields[key])
    .filter(Boolean);
}

/** Builds the option name/value pairs for a row, ignoring incomplete pairs. */
export function optionPairs(fields) {
  const pairs = [];
  for (let i = 1; i <= 3; i += 1) {
    const value = fields[`variant.option${i}Value`];
    if (isBlank(value)) continue;
    const name = fields[`variant.option${i}Name`] || defaultOptionName(i, value);
    pairs.push({ name: String(name), value: String(value) });
  }
  return pairs;
}

function defaultOptionName(index, value) {
  // Sheets often carry a bare "Size"/"Color" column with no name column.
  const guess = String(value).trim().toLowerCase();
  if (index === 1 && /^(xs|s|m|l|xl|xxl|\d{1,2})$/.test(guess)) return 'Size';
  return `Option ${index}`;
}

/** Derives a stable Shopify handle from a title. */
export function toHandle(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 255);
}
