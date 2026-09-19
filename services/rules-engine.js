/**
 * Rules engine.
 *
 * Every rule evaluation returns both a value and a human-readable explanation,
 * because the preview screen has to be able to justify each change it proposes
 * ("Supplier cost 2000 → cost x 1.35 → 2700"). Explanations are produced here
 * rather than in the UI so the same wording appears in previews, sync history
 * and notification emails.
 */

const MAX_EXPRESSION_DEPTH = 12;

export class RuleError extends Error {
  constructor(message, { ruleName, field } = {}) {
    super(message);
    this.name = 'RuleError';
    this.ruleName = ruleName;
    this.field = field;
  }
}

// ------------------------------------------------------------------ helpers

export function toNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // Supplier sheets arrive with currency symbols, thousands separators and
  // stray whitespace far more often than they arrive clean.
  const cleaned = String(value)
    .replace(/[^\d.,\-]/g, '')
    .replace(/,(?=\d{3}\b)/g, '')
    .replace(/,/g, '.');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value, currency = '') {
  if (value == null) return '—';
  const formatted = round2(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency}${formatted}` : formatted;
}

// ------------------------------------------------------------- conditions

const COMPARATORS = {
  equals: (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase(),
  not_equals: (a, b) => !COMPARATORS.equals(a, b),
  contains: (a, b) => String(a ?? '').toLowerCase().includes(String(b ?? '').toLowerCase()),
  not_contains: (a, b) => !COMPARATORS.contains(a, b),
  starts_with: (a, b) => String(a ?? '').toLowerCase().startsWith(String(b ?? '').toLowerCase()),
  is_empty: (a) => a == null || String(a).trim() === '',
  is_not_empty: (a) => !COMPARATORS.is_empty(a),
  gt: (a, b) => numericCompare(a, b, (x, y) => x > y),
  gte: (a, b) => numericCompare(a, b, (x, y) => x >= y),
  lt: (a, b) => numericCompare(a, b, (x, y) => x < y),
  lte: (a, b) => numericCompare(a, b, (x, y) => x <= y),
};

function numericCompare(a, b, compare) {
  const left = toNumber(a);
  const right = toNumber(b);
  if (left == null || right == null) return false;
  return compare(left, right);
}

export const CONDITION_OPERATORS = Object.keys(COMPARATORS);

/**
 * Evaluates a rule's condition block against a normalized source row.
 * An empty clause list means "always applies".
 */
export function matchesConditions(conditions, row) {
  const clauses = conditions?.clauses || [];
  if (clauses.length === 0) return { matched: true, description: 'Applies to every row' };

  const operator = conditions.operator === 'OR' ? 'OR' : 'AND';
  const results = clauses.map((clause) => {
    const compare = COMPARATORS[clause.op];
    if (!compare) throw new RuleError(`Unknown condition operator "${clause.op}"`);
    const actual = row[clause.field];
    return {
      matched: compare(actual, clause.value),
      text: `${clause.field} ${clause.op.replace(/_/g, ' ')} ${clause.value ?? ''}`.trim(),
    };
  });

  const matched = operator === 'AND' ? results.every((r) => r.matched) : results.some((r) => r.matched);
  return {
    matched,
    description: results.map((r) => r.text).join(operator === 'AND' ? ' AND ' : ' OR '),
  };
}

// ------------------------------------------------------- price expressions

/**
 * Evaluates a price expression AST.
 *
 * Nodes are either leaves — { value: 1.4 } or { field: 'variant.cost' } — or
 * operations { op: '*', left, right }. This is an AST rather than a string
 * formula on purpose: there is no parser and no eval, so a malicious or
 * malformed rule cannot execute anything.
 */
export function evaluateExpression(node, row, depth = 0) {
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw new RuleError('Price formula is nested too deeply');
  }
  if (node == null) throw new RuleError('Price formula is incomplete');

  if (Object.prototype.hasOwnProperty.call(node, 'value')) {
    const value = toNumber(node.value);
    if (value == null) throw new RuleError(`"${node.value}" is not a number`);
    return { value, text: String(round2(value)) };
  }

  if (node.field) {
    const raw = row[node.field];
    const value = toNumber(raw);
    if (value == null) {
      throw new RuleError(`No usable number in the "${node.field}" column`, { field: node.field });
    }
    return { value, text: shortFieldName(node.field) };
  }

  const left = evaluateExpression(node.left, row, depth + 1);
  const right = evaluateExpression(node.right, row, depth + 1);

  let value;
  switch (node.op) {
    case '+':
      value = left.value + right.value;
      break;
    case '-':
      value = left.value - right.value;
      break;
    case '*':
      value = left.value * right.value;
      break;
    case '/':
      if (right.value === 0) throw new RuleError('Price formula divides by zero');
      value = left.value / right.value;
      break;
    case '%':
      // "cost % 18" reads as "add 18 percent", which is how merchants phrase
      // GST and markup rules.
      value = left.value * (1 + right.value / 100);
      break;
    default:
      throw new RuleError(`Unknown operator "${node.op}" in price formula`);
  }

  const symbol = node.op === '%' ? '+ %' : node.op;
  return { value, text: `(${left.text} ${symbol} ${right.text})` };
}

function shortFieldName(field) {
  return field.replace(/^(variant|product|media)\./, '');
}

function applyRounding(value, rule) {
  const mode = rule.roundingMode || 'NONE';
  const to = rule.roundingTo != null ? Number(rule.roundingTo) : null;

  switch (mode) {
    case 'NEAREST':
      if (!to) return { value, note: null };
      return { value: Math.round(value / to) * to, note: `rounded to nearest ${to}` };
    case 'UP':
      if (!to) return { value: Math.ceil(value), note: 'rounded up' };
      return { value: Math.ceil(value / to) * to, note: `rounded up to ${to}` };
    case 'DOWN':
      if (!to) return { value: Math.floor(value), note: 'rounded down' };
      return { value: Math.floor(value / to) * to, note: `rounded down to ${to}` };
    case 'ENDING': {
      // "round to nearest x99": snap to the closest number ending in the given
      // value, staying at or above the computed price where possible.
      const ending = rule.endingValue != null ? Number(rule.endingValue) : 99;
      const base = Math.floor(value / 100) * 100;
      const candidate = base + ending;
      const result = candidate >= value ? candidate : candidate + 100;
      return { value: result, note: `rounded to end in ${ending}` };
    }
    default:
      return { value, note: null };
  }
}

/**
 * Applies the first matching price rule.
 * Returns null when no rule matches — the caller then leaves price untouched.
 */
export function applyPriceRules(rules, row, { currency = '' } = {}) {
  const priceRules = rules
    .filter((r) => r.kind === 'PRICE' && r.isEnabled && r.priceRule)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of priceRules) {
    const { matched, description } = matchesConditions(rule.conditions, row);
    if (!matched) continue;

    const config = rule.priceRule;
    const evaluated = evaluateExpression(config.expression, row);
    const steps = [`${config.expression?.field ? '' : ''}${evaluated.text} = ${formatMoney(evaluated.value, currency)}`];

    let value = evaluated.value;

    const rounded = applyRounding(value, config);
    if (rounded.note && rounded.value !== value) {
      value = rounded.value;
      steps.push(`${rounded.note} → ${formatMoney(value, currency)}`);
    } else {
      value = rounded.value;
    }

    if (config.minPrice != null && value < Number(config.minPrice)) {
      value = Number(config.minPrice);
      steps.push(`raised to the ${formatMoney(value, currency)} minimum`);
    }
    if (config.maxPrice != null && value > Number(config.maxPrice)) {
      value = Number(config.maxPrice);
      steps.push(`capped at the ${formatMoney(value, currency)} maximum`);
    }

    if (value < 0) throw new RuleError('Price formula produced a negative price', { ruleName: rule.name });

    return {
      field: config.targetField || 'variant.price',
      value: round2(value),
      ruleName: rule.name,
      formula: evaluated.text,
      explanation: {
        rule: rule.name,
        condition: description,
        steps,
        result: formatMoney(round2(value), currency),
      },
    };
  }

  return null;
}

// ------------------------------------------------------------- inventory

/**
 * Applies inventory rules to a supplier stock figure.
 * Returns { quantity, status, ruleName, explanation } — status is null when
 * the rule does not change product status.
 */
export function applyInventoryRules(rules, row, { supplierQuantity } = {}) {
  const inventoryRules = rules
    .filter((r) => r.kind === 'INVENTORY' && r.isEnabled && r.inventoryRule)
    .sort((a, b) => a.priority - b.priority);

  const incoming = toNumber(supplierQuantity);
  if (incoming == null) return null;

  for (const rule of inventoryRules) {
    const { matched, description } = matchesConditions(rule.conditions, row);
    if (!matched) continue;

    const config = rule.inventoryRule;
    const steps = [`Supplier stock ${incoming}`];
    let quantity = incoming;

    if (config.minThreshold != null && quantity < config.minThreshold) {
      if (config.zeroOutBelowMin) {
        quantity = 0;
        steps.push(`below the ${config.minThreshold} threshold → set to 0`);
      }
    }

    if (quantity > 0 && config.safetyStock > 0) {
      quantity = Math.max(0, quantity - config.safetyStock);
      steps.push(`less ${config.safetyStock} safety stock → ${quantity}`);
    }

    if (config.maxInventory != null && quantity > config.maxInventory) {
      quantity = config.maxInventory;
      steps.push(`capped at ${config.maxInventory}`);
    }

    let status = null;
    if (quantity === 0 && config.setStatusWhenZero) {
      status = config.setStatusWhenZero;
      steps.push(`out of stock → product set to ${status.toLowerCase()}`);
    } else if (quantity > 0 && config.setStatusWhenInStock) {
      status = config.setStatusWhenInStock;
      steps.push(`in stock → product set to ${status.toLowerCase()}`);
    }

    return {
      quantity: Math.round(quantity),
      status,
      ruleName: rule.name,
      explanation: { rule: rule.name, condition: description, steps, result: String(Math.round(quantity)) },
    };
  }

  return {
    quantity: Math.round(incoming),
    status: null,
    ruleName: null,
    explanation: {
      rule: 'No inventory rule',
      condition: 'Applies to every row',
      steps: [`Supplier stock ${incoming}`],
      result: String(Math.round(incoming)),
    },
  };
}

// ------------------------------------------------------------------ tags

/** Builds the tag list for a row from the enabled tag rules. */
export function applyTagRules(rules, row, { existingTags = [] } = {}) {
  const tagRules = rules
    .filter((r) => r.kind === 'TAG' && r.isEnabled && r.tagRule)
    .sort((a, b) => a.priority - b.priority);

  if (tagRules.length === 0) return null;

  const collected = new Set();
  let replaceExisting = false;
  const sources = [];
  const appliedRules = [];

  for (const rule of tagRules) {
    const { matched } = matchesConditions(rule.conditions, row);
    if (!matched) continue;
    appliedRules.push(rule.name);

    const config = rule.tagRule;
    if (config.replaceExisting) replaceExisting = true;

    for (const field of config.sourceFields || []) {
      const raw = row[field];
      if (raw == null || String(raw).trim() === '') continue;
      for (const part of String(raw).split(/[,;|]/)) {
        const tag = normalizeTag(part, config.lowercase);
        if (tag) {
          collected.add(tag);
          sources.push(`${shortFieldName(field)} → ${tag}`);
        }
      }
    }
    for (const staticTag of config.staticTags || []) {
      const tag = normalizeTag(staticTag, config.lowercase);
      if (tag) {
        collected.add(tag);
        sources.push(`always → ${tag}`);
      }
    }
  }

  if (appliedRules.length === 0) return null;

  if (!replaceExisting) {
    for (const tag of existingTags) collected.add(tag);
  }

  const tags = [...collected].sort();
  return {
    tags,
    replaceExisting,
    ruleName: appliedRules.join(', '),
    explanation: {
      rule: appliedRules.join(', '),
      condition: replaceExisting ? 'Replaces existing tags' : 'Added to existing tags',
      steps: sources,
      result: tags.join(', ') || '—',
    },
  };
}

function normalizeTag(value, lowercase = true) {
  const tag = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!tag) return null;
  return lowercase ? tag.toLowerCase() : tag;
}

// ----------------------------------------------------------- collections

/**
 * Resolves which collection titles a row belongs to.
 * Returns { titles, createIfMissing, explanation } or null.
 */
export function applyCollectionRules(rules, row) {
  const collectionRules = rules
    .filter((r) => r.kind === 'COLLECTION' && r.isEnabled && r.collectionRule)
    .sort((a, b) => a.priority - b.priority);

  if (collectionRules.length === 0) return null;

  const titles = new Set();
  const steps = [];
  const appliedRules = [];
  let createIfMissing = false;

  for (const rule of collectionRules) {
    const { matched } = matchesConditions(rule.conditions, row);
    if (!matched) continue;

    const config = rule.collectionRule;
    if (config.createIfMissing) createIfMissing = true;

    const sourceValue = row[config.sourceField];
    const values = String(sourceValue ?? '')
      .split(/[,;|]/)
      .map((v) => v.trim())
      .filter(Boolean);

    if (values.length === 0) {
      if (config.fallbackCollection) {
        titles.add(config.fallbackCollection);
        steps.push(`no value → ${config.fallbackCollection}`);
        appliedRules.push(rule.name);
      }
      continue;
    }

    appliedRules.push(rule.name);
    const valueMap = new Map(
      (config.valueMap || []).map((entry) => [String(entry.from).trim().toLowerCase(), entry.to])
    );

    for (const value of values) {
      const mapped = valueMap.get(value.toLowerCase());
      const title = mapped || value;
      titles.add(title);
      steps.push(mapped ? `${value} → ${title}` : `${value} → ${title} (unchanged)`);
    }
  }

  if (appliedRules.length === 0) return null;

  const list = [...titles];
  return {
    titles: list,
    createIfMissing,
    ruleName: appliedRules.join(', '),
    explanation: {
      rule: appliedRules.join(', '),
      condition: 'Category mapped to collections',
      steps,
      result: list.join(', ') || '—',
    },
  };
}

// --------------------------------------------------------- vendor/status

/** Vendor and status rules are simple overrides with conditions. */
export function applyOverrideRules(rules, row, kind) {
  const applicable = rules
    .filter((r) => r.kind === kind && r.isEnabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of applicable) {
    const { matched, description } = matchesConditions(rule.conditions, row);
    if (!matched) continue;
    const value = rule.conditions?.setValue;
    if (value == null || value === '') continue;
    return {
      value,
      ruleName: rule.name,
      explanation: {
        rule: rule.name,
        condition: description,
        steps: [`set to ${value}`],
        result: String(value),
      },
    };
  }
  return null;
}
