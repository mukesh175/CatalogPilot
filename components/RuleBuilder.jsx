'use client';

import { useMemo, useState } from 'react';
import { Badge } from './ui.jsx';

/**
 * Visual rule builder.
 *
 * The price formula is edited as a chain of operations rather than free text,
 * so what the merchant builds is always a valid expression tree — the same
 * shape the server evaluates. A live example shows the result on a sample cost
 * as they type, which is the fastest way to catch a wrong operator.
 */

const OPERATORS = [
  { value: '*', label: '×', hint: 'multiply' },
  { value: '+', label: '+', hint: 'add' },
  { value: '-', label: '−', hint: 'subtract' },
  { value: '/', label: '÷', hint: 'divide' },
  { value: '%', label: '+ %', hint: 'add a percentage' },
];

const BASE_FIELDS = [
  { value: 'variant.cost', label: 'Supplier cost' },
  { value: 'variant.price', label: 'Sheet price' },
  { value: 'variant.compareAtPrice', label: 'Sheet compare-at price' },
];

/** Flattens an expression tree into the left-to-right step list the UI edits. */
export function expressionToSteps(expression) {
  if (!expression) return { base: 'variant.cost', steps: [] };
  const steps = [];
  let node = expression;
  while (node && node.op) {
    steps.unshift({ op: node.op, value: node.right?.value ?? '' });
    node = node.left;
  }
  return { base: node?.field || 'variant.cost', steps };
}

/** Rebuilds the tree from the step list. */
export function stepsToExpression(base, steps) {
  let node = { field: base };
  for (const step of steps) {
    if (step.value === '' || step.value == null) continue;
    node = { op: step.op, left: node, right: { value: Number(step.value) } };
  }
  return node;
}

function evaluatePreview(base, steps, sampleCost = 2000) {
  let value = sampleCost;
  for (const step of steps) {
    const operand = Number(step.value);
    if (!Number.isFinite(operand)) continue;
    switch (step.op) {
      case '*':
        value *= operand;
        break;
      case '+':
        value += operand;
        break;
      case '-':
        value -= operand;
        break;
      case '/':
        if (operand === 0) return null;
        value /= operand;
        break;
      case '%':
        value *= 1 + operand / 100;
        break;
      default:
        break;
    }
  }
  return value;
}

export function PriceFormulaBuilder({ value, onChange }) {
  const { base, steps } = useMemo(() => expressionToSteps(value), [value]);

  const update = (nextBase, nextSteps) => {
    onChange(stepsToExpression(nextBase, nextSteps));
  };

  const preview = evaluatePreview(base, steps);

  return (
    <div>
      <div className="cp-inline flex-wrap">
        <select
          className="cp-select"
          style={{ width: 'auto' }}
          value={base}
          onChange={(event) => update(event.target.value, steps)}
          aria-label="Starting value"
        >
          {BASE_FIELDS.map((field) => (
            <option key={field.value} value={field.value}>
              {field.label}
            </option>
          ))}
        </select>

        {steps.map((step, index) => (
          <span key={index} className="cp-inline">
            <select
              className="cp-select"
              style={{ width: 'auto' }}
              value={step.op}
              onChange={(event) => {
                const next = steps.map((s, i) => (i === index ? { ...s, op: event.target.value } : s));
                update(base, next);
              }}
              aria-label={`Operator ${index + 1}`}
            >
              {OPERATORS.map((operator) => (
                <option key={operator.value} value={operator.value}>
                  {operator.label} ({operator.hint})
                </option>
              ))}
            </select>

            <input
              type="number"
              step="any"
              className="cp-input"
              style={{ width: 110 }}
              value={step.value}
              onChange={(event) => {
                const next = steps.map((s, i) => (i === index ? { ...s, value: event.target.value } : s));
                update(base, next);
              }}
              aria-label={`Value ${index + 1}`}
            />

            <button
              type="button"
              className="cp-btn cp-btn-plain cp-btn-sm"
              onClick={() => update(base, steps.filter((_, i) => i !== index))}
              aria-label={`Remove step ${index + 1}`}
            >
              ✕
            </button>
          </span>
        ))}

        <button
          type="button"
          className="cp-btn cp-btn-sm"
          onClick={() => update(base, [...steps, { op: '*', value: '1' }])}
        >
          + Add step
        </button>
      </div>

      <div className="cp-explain mt-3">
        <span className="cp-subdued">Example: a supplier cost of 2,000 becomes </span>
        <strong>{preview == null ? 'invalid' : preview.toFixed(2)}</strong>
      </div>
    </div>
  );
}

/** Condition editor shared by every rule type. */
export function ConditionBuilder({ conditions, fields, onChange }) {
  const clauses = conditions?.clauses || [];
  const operator = conditions?.operator || 'AND';

  const update = (patch) => onChange({ ...conditions, operator, clauses, ...patch });

  return (
    <div>
      {clauses.length === 0 ? (
        <p className="cp-subdued" style={{ fontSize: 13 }}>
          This rule applies to every row. Add a condition to narrow it down.
        </p>
      ) : (
        <div className="cp-stack-sm">
          {clauses.map((clause, index) => (
            <div key={index} className="cp-inline flex-wrap">
              {index > 0 ? (
                <select
                  className="cp-select"
                  style={{ width: 'auto' }}
                  value={operator}
                  onChange={(event) => update({ operator: event.target.value })}
                  aria-label="Combine conditions with"
                >
                  <option value="AND">AND</option>
                  <option value="OR">OR</option>
                </select>
              ) : (
                <span className="cp-badge">IF</span>
              )}

              <select
                className="cp-select"
                style={{ width: 'auto' }}
                value={clause.field}
                onChange={(event) => {
                  const next = clauses.map((c, i) => (i === index ? { ...c, field: event.target.value } : c));
                  update({ clauses: next });
                }}
                aria-label={`Condition field ${index + 1}`}
              >
                {fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>

              <select
                className="cp-select"
                style={{ width: 'auto' }}
                value={clause.op}
                onChange={(event) => {
                  const next = clauses.map((c, i) => (i === index ? { ...c, op: event.target.value } : c));
                  update({ clauses: next });
                }}
                aria-label={`Condition operator ${index + 1}`}
              >
                <option value="equals">is</option>
                <option value="not_equals">is not</option>
                <option value="contains">contains</option>
                <option value="not_contains">does not contain</option>
                <option value="starts_with">starts with</option>
                <option value="gt">is greater than</option>
                <option value="gte">is at least</option>
                <option value="lt">is less than</option>
                <option value="lte">is at most</option>
                <option value="is_empty">is empty</option>
                <option value="is_not_empty">is not empty</option>
              </select>

              {!['is_empty', 'is_not_empty'].includes(clause.op) ? (
                <input
                  className="cp-input"
                  style={{ width: 160 }}
                  value={clause.value ?? ''}
                  onChange={(event) => {
                    const next = clauses.map((c, i) => (i === index ? { ...c, value: event.target.value } : c));
                    update({ clauses: next });
                  }}
                  aria-label={`Condition value ${index + 1}`}
                />
              ) : null}

              <button
                type="button"
                className="cp-btn cp-btn-plain cp-btn-sm"
                onClick={() => update({ clauses: clauses.filter((_, i) => i !== index) })}
                aria-label={`Remove condition ${index + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="cp-btn cp-btn-sm mt-3"
        onClick={() =>
          update({
            clauses: [...clauses, { field: fields[0]?.key || 'product.productType', op: 'equals', value: '' }],
          })
        }
      >
        + Add condition
      </button>
    </div>
  );
}

/** Editable list of "supplier value → Shopify collection" pairs. */
export function ValueMapEditor({ valueMap = [], onChange, fromLabel = 'Supplier value', toLabel = 'Collection' }) {
  const [draft, setDraft] = useState({ from: '', to: '' });

  return (
    <div>
      {valueMap.length > 0 ? (
        <div className="cp-table-wrap mb-3">
          <table className="cp-table">
            <thead>
              <tr>
                <th scope="col">{fromLabel}</th>
                <th scope="col">{toLabel}</th>
                <th scope="col">
                  <span className="cp-visually-hidden">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {valueMap.map((entry, index) => (
                <tr key={index}>
                  <td>{entry.from}</td>
                  <td>
                    <Badge tone="info">{entry.to}</Badge>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cp-btn cp-btn-plain cp-btn-sm"
                      onClick={() => onChange(valueMap.filter((_, i) => i !== index))}
                      aria-label={`Remove mapping ${entry.from}`}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="cp-inline">
        <input
          className="cp-input"
          style={{ width: 180 }}
          placeholder={fromLabel}
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          aria-label={fromLabel}
        />
        <span aria-hidden="true">→</span>
        <input
          className="cp-input"
          style={{ width: 180 }}
          placeholder={toLabel}
          value={draft.to}
          onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          aria-label={toLabel}
        />
        <button
          type="button"
          className="cp-btn cp-btn-sm"
          disabled={!draft.from.trim() || !draft.to.trim()}
          onClick={() => {
            onChange([...valueMap, { from: draft.from.trim(), to: draft.to.trim() }]);
            setDraft({ from: '', to: '' });
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
