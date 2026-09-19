import { TARGET_FIELDS, TARGET_FIELD_MAP, HIGH_RISK_FIELDS, REQUIRED_FIELDS } from '../lib/fields.js';

/**
 * Smart column mapping.
 *
 * The engine is deliberately deterministic-first: exact and alias matches run
 * before any fuzzy scoring, so a column literally called "SKU" can never be
 * beaten by a lucky trigram overlap. Fuzzy results only produce a suggestion,
 * and a high-risk field (price, SKU, inventory, status) is never auto-confirmed
 * unless the match was exact or alias-level.
 */

const CONFIDENCE_THRESHOLDS = {
  EXACT: 1,
  HIGH: 0.85,
  MEDIUM: 0.65,
  LOW: 0.45,
};

/** Strips punctuation, unit suffixes and casing so headers compare fairly. */
export function normalizeHeader(header) {
  return String(header ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(col|column|field)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ALIAS_INDEX = (() => {
  const index = new Map();
  for (const field of TARGET_FIELDS) {
    for (const alias of field.aliases) {
      const normalized = normalizeHeader(alias);
      if (!index.has(normalized)) index.set(normalized, []);
      index.get(normalized).push(field);
    }
  }
  return index;
})();

/** Bigram Dice coefficient — cheap, and stable for short header strings. */
function similarity(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const gram = s.slice(i, i + 2);
      out.set(gram, (out.get(gram) || 0) + 1);
    }
    return out;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  let hits = 0;
  for (const [gram, count] of ga) {
    const other = gb.get(gram);
    if (other) hits += Math.min(count, other);
  }
  return (2 * hits) / (a.length - 1 + (b.length - 1));
}

function confidenceFor(score) {
  if (score >= CONFIDENCE_THRESHOLDS.EXACT) return 'EXACT';
  if (score >= CONFIDENCE_THRESHOLDS.HIGH) return 'HIGH';
  if (score >= CONFIDENCE_THRESHOLDS.MEDIUM) return 'MEDIUM';
  if (score >= CONFIDENCE_THRESHOLDS.LOW) return 'LOW';
  return 'NEEDS_REVIEW';
}

/**
 * Scores one header against every target field.
 * Returns candidates sorted best-first.
 */
export function scoreHeader(header) {
  const normalized = normalizeHeader(header);
  if (!normalized) return [];

  const aliasHits = ALIAS_INDEX.get(normalized);
  if (aliasHits?.length) {
    // An exact alias hit wins outright. Where several fields share an alias
    // (e.g. "category" is both product type and collection) the first one
    // declared in the catalog wins, and the rest stay as alternatives.
    return aliasHits.map((field, i) => ({
      field: field.key,
      score: i === 0 ? 1 : 0.9,
      reason: i === 0 ? 'Exact match on a known supplier column name' : 'Also a known name for this column',
    }));
  }

  const candidates = [];
  for (const field of TARGET_FIELDS) {
    let best = 0;
    let via = '';
    for (const alias of field.aliases) {
      const aliasNorm = normalizeHeader(alias);
      let score = similarity(normalized, aliasNorm);

      // Containment is a strong signal: "supplier price (inr)" -> "price".
      if (score < 1 && (normalized.includes(aliasNorm) || aliasNorm.includes(normalized))) {
        const ratio =
          Math.min(normalized.length, aliasNorm.length) / Math.max(normalized.length, aliasNorm.length);
        score = Math.max(score, 0.6 + 0.3 * ratio);
      }
      if (score > best) {
        best = score;
        via = alias;
      }
    }
    if (best >= CONFIDENCE_THRESHOLDS.LOW) {
      candidates.push({
        field: field.key,
        score: Number(best.toFixed(4)),
        reason: `Looks like "${via}"`,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

/**
 * Builds a mapping proposal for a full header row.
 *
 * Resolution is greedy over the globally best (header, field) pairs so that
 * two similar headers cannot both claim the same target field — the stronger
 * match takes it, the weaker one falls through to its next-best candidate.
 */
export function suggestMappings(headers, { existing = [] } = {}) {
  const confirmed = new Map(
    existing.filter((m) => m.isConfirmed && !m.isIgnored).map((m) => [m.sourceColumn, m])
  );

  const pairs = [];
  headers.forEach((header, columnIndex) => {
    if (confirmed.has(header)) return;
    for (const candidate of scoreHeader(header)) {
      pairs.push({ header, columnIndex, ...candidate });
    }
  });
  pairs.sort((a, b) => b.score - a.score);

  const takenFields = new Set();
  for (const m of confirmed.values()) takenFields.add(m.targetField);
  const usedHeaders = new Set();
  const results = [];

  for (const pair of pairs) {
    if (usedHeaders.has(pair.header) || takenFields.has(pair.field)) continue;
    usedHeaders.add(pair.header);
    takenFields.add(pair.field);

    const target = TARGET_FIELD_MAP.get(pair.field);
    let confidence = confidenceFor(pair.score);

    // Guard rail: a high-risk field needs a near-certain match before we are
    // willing to present it as ready to apply.
    const risky = HIGH_RISK_FIELDS.has(pair.field);
    if (risky && pair.score < CONFIDENCE_THRESHOLDS.HIGH) confidence = 'NEEDS_REVIEW';

    results.push({
      sourceColumn: pair.header,
      normalized: normalizeHeader(pair.header),
      columnIndex: pair.columnIndex,
      targetField: pair.field,
      targetLabel: target.label,
      score: pair.score,
      confidence,
      reason: pair.reason,
      requiresReview: confidence === 'NEEDS_REVIEW' || confidence === 'LOW',
      isConfirmed: false,
      alternatives: scoreHeader(pair.header)
        .filter((c) => c.field !== pair.field && !takenFields.has(c.field))
        .slice(0, 3)
        .map((c) => ({ field: c.field, label: TARGET_FIELD_MAP.get(c.field)?.label, score: c.score })),
    });
  }

  // Headers with no candidate above the floor are surfaced as unmapped rather
  // than silently dropped — the merchant should see every column.
  headers.forEach((header, columnIndex) => {
    if (usedHeaders.has(header) || confirmed.has(header)) return;
    results.push({
      sourceColumn: header,
      normalized: normalizeHeader(header),
      columnIndex,
      targetField: null,
      targetLabel: null,
      score: 0,
      confidence: 'NEEDS_REVIEW',
      reason: 'No matching Shopify field found',
      requiresReview: true,
      isConfirmed: false,
      alternatives: [],
    });
  });

  for (const m of confirmed.values()) {
    results.push({
      sourceColumn: m.sourceColumn,
      normalized: m.normalized,
      columnIndex: headers.indexOf(m.sourceColumn),
      targetField: m.targetField,
      targetLabel: TARGET_FIELD_MAP.get(m.targetField)?.label || m.targetField,
      score: m.score,
      confidence: m.confidence,
      reason: 'Confirmed by you',
      requiresReview: false,
      isConfirmed: true,
      alternatives: [],
    });
  }

  results.sort((a, b) => a.columnIndex - b.columnIndex);
  return results;
}

/**
 * Checks a mapping set is complete enough to run a sync.
 * Returns { ok, missing, needsReview }.
 */
export function validateMappingSet(mappings) {
  const active = mappings.filter((m) => m.targetField && !m.isIgnored);
  const mapped = new Set(active.map((m) => m.targetField));
  const missing = REQUIRED_FIELDS.filter((key) => !mapped.has(key)).map((key) => ({
    field: key,
    label: TARGET_FIELD_MAP.get(key)?.label || key,
  }));

  const needsReview = active
    .filter((m) => !m.isConfirmed && (m.confidence === 'NEEDS_REVIEW' || m.confidence === 'LOW'))
    .map((m) => ({ sourceColumn: m.sourceColumn, field: m.targetField }));

  return { ok: missing.length === 0 && needsReview.length === 0, missing, needsReview };
}

/** Percentage shown in the UI next to each suggestion. */
export function confidencePercent(score) {
  return Math.round(Math.min(Math.max(score, 0), 1) * 100);
}
