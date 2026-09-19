'use client';

import { useState } from 'react';
import { api } from '../lib/client-api.js';
import { useApi } from '../lib/use-api.js';
import { useToast, useConfirm } from './AppProviders.jsx';
import { Card, Banner, EmptyState, SkeletonTable, Badge, PageHeader } from './ui.jsx';
import { PriceFormulaBuilder, ConditionBuilder, ValueMapEditor } from './RuleBuilder.jsx';

/**
 * One screen serves all four rule types.
 *
 * The differences between them live in `RULE_KIND_CONFIG` rather than in four
 * near-identical pages, so a change to conditions, priority or the empty state
 * applies everywhere at once.
 */

const KIND_CONFIG = {
  PRICE: {
    title: 'Price rules',
    description: 'Calculate selling prices from supplier cost, with rounding and safety limits.',
    emptyTitle: 'No price rules yet',
    emptyBody:
      'Add a rule so CatalogPilot can work out your selling price from the supplier cost — for example cost × 1.4, rounded to a price ending in 99.',
    examples: [
      { given: 'Supplier cost 500', rule: 'Cost × 1.40', result: 'Price 700' },
      { given: 'Supplier cost 500', rule: 'Cost × 1.40, rounded to end in 99', result: 'Price 799' },
      { given: 'Supplier cost 1,000', rule: 'Cost + 18% GST', result: 'Price 1,180' },
      { given: 'Supplier cost 200', rule: 'Cost × 1.40, with a minimum of 499', result: 'Price 499' },
      {
        given: 'Category is Electronics',
        rule: 'IF category = Electronics THEN cost × 1.25',
        result: 'A lower markup than the rest of the catalog',
      },
    ],
    defaults: () => ({
      kind: 'PRICE',
      name: 'New price rule',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.4 } },
        targetField: 'variant.price',
        roundingMode: 'NONE',
        roundingTo: null,
        endingValue: null,
        minPrice: null,
        maxPrice: null,
      },
    }),
  },
  INVENTORY: {
    title: 'Inventory rules',
    description: 'Decide how supplier stock becomes Shopify inventory, and when products go draft.',
    emptyTitle: 'No inventory rules yet',
    emptyBody:
      'Add a rule to hold back safety stock, zero out low quantities, or draft products automatically when they sell out.',
    examples: [
      { given: 'Supplier stock 20', rule: 'Hold back 3 as safety stock', result: 'Shopify inventory 17' },
      { given: 'Supplier stock 2', rule: 'Treat anything under 5 as zero', result: 'Shopify inventory 0' },
      { given: 'Supplier stock 0', rule: 'Draft the product at zero stock', result: 'Product moves to draft' },
      { given: 'Supplier stock back to 12', rule: 'Activate when back in stock', result: 'Product goes live again' },
    ],
    defaults: () => ({
      kind: 'INVENTORY',
      name: 'New inventory rule',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        safetyStock: 0,
        minThreshold: null,
        zeroOutBelowMin: false,
        setStatusWhenZero: null,
        setStatusWhenInStock: null,
        maxInventory: null,
      },
    }),
  },
  COLLECTION: {
    title: 'Collection rules',
    description: 'Map supplier categories onto the collections in your store.',
    emptyTitle: 'No collection rules yet',
    emptyBody:
      'Add a rule to place products into collections automatically — for example “T-Shirts” in your sheet becoming “Men’s T-Shirts” in Shopify.',
    examples: [
      { given: 'Category is T-Shirts', rule: 'T-Shirts → Men’s T-Shirts', result: 'Added to Men’s T-Shirts' },
      { given: 'Category is Jeans', rule: 'Jeans → Men’s Jeans', result: 'Added to Men’s Jeans' },
      {
        given: 'Category is “Shirts, Formal”',
        rule: 'One product, two categories',
        result: 'Added to both collections',
      },
      {
        given: 'Category is Hats, with no rename set',
        rule: 'Unlisted values pass through',
        result: 'Added to Hats',
      },
    ],
    defaults: () => ({
      kind: 'COLLECTION',
      name: 'New collection rule',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        sourceField: 'product.productType',
        createIfMissing: false,
        valueMap: [],
        fallbackCollection: null,
      },
    }),
  },
  TAG: {
    title: 'Tag rules',
    description: 'Build product tags from supplier columns and fixed values.',
    emptyTitle: 'No tag rules yet',
    emptyBody:
      'Add a rule to tag products automatically from their brand, category or supplier — for example “nike, shoes”.',
    examples: [
      { given: 'Brand Nike, Category Shoes', rule: 'Tag from brand and category', result: 'Tags: nike, shoes' },
      { given: 'Any product', rule: 'Always add “imported”', result: 'Tags: imported' },
      {
        given: 'Product already tagged “sale” in Shopify',
        rule: 'Add to existing tags (the default)',
        result: 'Tags: sale, nike, shoes',
      },
    ],
    defaults: () => ({
      kind: 'TAG',
      name: 'New tag rule',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: { sourceFields: [], staticTags: [], lowercase: true, replaceExisting: false },
    }),
  },
};

export function RulesScreen({ kind }) {
  const config = KIND_CONFIG[kind];
  const toast = useToast();
  const confirm = useConfirm();

  const { data, loading, error, refresh } = useApi(`/api/rules?kind=${kind}`);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const rules = data?.rules || [];
  const conditionFields = data?.conditionFields || [];

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        kind: editing.kind,
        name: editing.name,
        priority: editing.priority,
        isEnabled: editing.isEnabled,
        conditions: editing.conditions,
        config: editing.config,
        dataSourceId: editing.dataSourceId || null,
      };
      if (editing.id) await api.put(`/api/rules/${editing.id}`, payload);
      else await api.post('/api/rules', payload);

      toast.success(editing.id ? 'Rule updated.' : 'Rule created.');
      setEditing(null);
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule) => {
    const ok = await confirm({
      title: 'Delete this rule?',
      body: `“${rule.name}” will stop applying on the next sync. Products already synced keep their current values.`,
      confirmLabel: 'Delete rule',
      destructive: true,
    });
    if (!ok) return;

    try {
      await api.delete(`/api/rules/${rule.id}`);
      toast.success('Rule deleted.');
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  const toggle = async (rule) => {
    try {
      await api.put(`/api/rules/${rule.id}`, {
        kind: rule.kind,
        name: rule.name,
        priority: rule.priority,
        isEnabled: !rule.isEnabled,
        conditions: rule.conditions,
        config: configFromRule(rule),
        dataSourceId: rule.dataSourceId,
      });
      refresh();
    } catch (caught) {
      toast.error(caught.message);
    }
  };

  return (
    <div className="cp-stack">
      <PageHeader
        title={config.title}
        description={config.description}
        actions={
          <button
            type="button"
            className="cp-btn cp-btn-primary"
            onClick={() => setEditing(config.defaults())}
          >
            Add rule
          </button>
        }
      />

      {error ? <Banner tone="critical">{error.message}</Banner> : null}

      {!editing ? <RuleExamples title={config.title} examples={config.examples} /> : null}

      {editing ? (
        <RuleEditor
          rule={editing}
          conditionFields={conditionFields}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
          saving={saving}
        />
      ) : null}

      <Card padded={false}>
        {loading ? (
          <SkeletonTable rows={4} columns={4} />
        ) : rules.length === 0 ? (
          <EmptyState
            icon="⚙"
            title={config.emptyTitle}
            description={config.emptyBody}
            action={
              <button
                type="button"
                className="cp-btn cp-btn-primary"
                onClick={() => setEditing(config.defaults())}
              >
                Add your first rule
              </button>
            }
          />
        ) : (
          <div className="cp-table-wrap">
            <table className="cp-table">
              <caption className="cp-visually-hidden">{config.title}</caption>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">What it does</th>
                  <th scope="col">Order</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="cp-visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td style={{ fontWeight: 550 }}>{rule.name}</td>
                    <td className="cp-subdued">{describeRule(rule)}</td>
                    <td className="cp-table-numeric">{rule.priority}</td>
                    <td>
                      <Badge tone={rule.isEnabled ? 'success' : 'default'}>
                        {rule.isEnabled ? 'Active' : 'Paused'}
                      </Badge>
                    </td>
                    <td>
                      <div className="cp-inline">
                        <button
                          type="button"
                          className="cp-btn cp-btn-sm"
                          onClick={() => setEditing({ ...rule, config: configFromRule(rule) })}
                        >
                          Edit
                        </button>
                        <button type="button" className="cp-btn cp-btn-sm" onClick={() => toggle(rule)}>
                          {rule.isEnabled ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          type="button"
                          className="cp-btn cp-btn-sm"
                          onClick={() => remove(rule)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rules.length > 1 ? (
        <Banner tone="info">
          Rules run in order. The first one whose conditions match a row is the one that applies, so put
          your most specific rules first with a lower order number.
        </Banner>
      ) : null}
    </div>
  );
}

/**
 * Worked examples for the rule type on screen.
 *
 * A rule builder is abstract until you see what it does to a real row, so each
 * example reads left to right: what the sheet says, what the rule is, and what
 * ends up in Shopify. Collapsed once the merchant has rules of their own, since
 * by then they have their own examples.
 */
function RuleExamples({ title, examples }) {
  const [open, setOpen] = useState(false);

  if (!examples?.length) return null;

  return (
    <Card
      title={`How ${title.toLowerCase()} work`}
      actions={
        <button
          type="button"
          className="cp-btn cp-btn-sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide examples' : 'Show examples'}
        </button>
      }
      padded={false}
    >
      {open ? (
        <div className="cp-table-wrap">
          <table className="cp-table">
            <caption className="cp-visually-hidden">Examples of {title.toLowerCase()}</caption>
            <thead>
              <tr>
                <th scope="col">Your sheet says</th>
                <th scope="col">The rule</th>
                <th scope="col">What happens in Shopify</th>
              </tr>
            </thead>
            <tbody>
              {examples.map((example, index) => (
                <tr key={index}>
                  <td className="cp-subdued">{example.given}</td>
                  <td>
                    <Badge tone="info">{example.rule}</Badge>
                  </td>
                  <td style={{ fontWeight: 550 }}>{example.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cp-card-body" style={{ paddingTop: 12, paddingBottom: 12 }}>
          <span className="cp-subdued" style={{ fontSize: 13 }}>
            {examples[0].given} → <strong>{examples[0].result}</strong>, and {examples.length - 1} more
            example{examples.length > 2 ? 's' : ''}.
          </span>
        </div>
      )}
    </Card>
  );
}

function RuleEditor({ rule, conditionFields, onChange, onSave, onCancel, saving }) {
  const set = (patch) => onChange({ ...rule, ...patch });
  const setConfig = (patch) => onChange({ ...rule, config: { ...rule.config, ...patch } });

  return (
    <Card
      title={rule.id ? 'Edit rule' : 'New rule'}
      footer={
        <div className="cp-spread">
          <span className="cp-subdued" style={{ fontSize: 12.5 }}>
            Changes apply from the next sync onwards.
          </span>
          <div className="cp-inline">
            <button type="button" className="cp-btn" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="cp-btn cp-btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        </div>
      }
    >
      <div className="row g-3">
        <div className="col-12 col-md-8">
          <div className="cp-field">
            <label className="cp-label" htmlFor="rule-name">
              Rule name
            </label>
            <input
              id="rule-name"
              className="cp-input"
              value={rule.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          </div>
        </div>
        <div className="col-12 col-md-4">
          <div className="cp-field">
            <label className="cp-label" htmlFor="rule-priority">
              Order
            </label>
            <input
              id="rule-priority"
              type="number"
              className="cp-input"
              value={rule.priority}
              onChange={(event) => set({ priority: Number(event.target.value) })}
            />
            <span className="cp-help">Lower numbers run first.</span>
          </div>
        </div>
      </div>

      <div className="cp-field">
        <span className="cp-label">When does this rule apply?</span>
        <ConditionBuilder
          conditions={rule.conditions}
          fields={conditionFields}
          onChange={(conditions) => set({ conditions })}
        />
      </div>

      <hr />

      {rule.kind === 'PRICE' ? <PriceRuleFields config={rule.config} setConfig={setConfig} /> : null}
      {rule.kind === 'INVENTORY' ? <InventoryRuleFields config={rule.config} setConfig={setConfig} /> : null}
      {rule.kind === 'COLLECTION' ? <CollectionRuleFields config={rule.config} setConfig={setConfig} /> : null}
      {rule.kind === 'TAG' ? <TagRuleFields config={rule.config} setConfig={setConfig} /> : null}
    </Card>
  );
}

function PriceRuleFields({ config, setConfig }) {
  return (
    <div>
      <div className="cp-field">
        <span className="cp-label">Price formula</span>
        <PriceFormulaBuilder value={config.expression} onChange={(expression) => setConfig({ expression })} />
      </div>

      <div className="row g-3">
        <div className="col-12 col-md-4">
          <div className="cp-field">
            <label className="cp-label" htmlFor="price-target">
              Write the result to
            </label>
            <select
              id="price-target"
              className="cp-select"
              value={config.targetField}
              onChange={(event) => setConfig({ targetField: event.target.value })}
            >
              <option value="variant.price">Price</option>
              <option value="variant.compareAtPrice">Compare-at price</option>
            </select>
          </div>
        </div>

        <div className="col-12 col-md-4">
          <div className="cp-field">
            <label className="cp-label" htmlFor="price-rounding">
              Rounding
            </label>
            <select
              id="price-rounding"
              className="cp-select"
              value={config.roundingMode || 'NONE'}
              onChange={(event) => setConfig({ roundingMode: event.target.value })}
            >
              <option value="NONE">No rounding</option>
              <option value="NEAREST">Nearest</option>
              <option value="UP">Round up</option>
              <option value="DOWN">Round down</option>
              <option value="ENDING">End in a specific number</option>
            </select>
          </div>
        </div>

        <div className="col-12 col-md-4">
          {config.roundingMode === 'ENDING' ? (
            <div className="cp-field">
              <label className="cp-label" htmlFor="price-ending">
                Ending in
              </label>
              <input
                id="price-ending"
                type="number"
                className="cp-input"
                value={config.endingValue ?? 99}
                onChange={(event) => setConfig({ endingValue: Number(event.target.value) })}
              />
              <span className="cp-help">For example 99 gives 1,499 or 2,999.</span>
            </div>
          ) : config.roundingMode && config.roundingMode !== 'NONE' ? (
            <div className="cp-field">
              <label className="cp-label" htmlFor="price-rounding-to">
                Round to the nearest
              </label>
              <input
                id="price-rounding-to"
                type="number"
                className="cp-input"
                value={config.roundingTo ?? 1}
                onChange={(event) => setConfig({ roundingTo: Number(event.target.value) })}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="row g-3">
        <div className="col-6">
          <div className="cp-field">
            <label className="cp-label" htmlFor="price-min">
              Minimum price (optional)
            </label>
            <input
              id="price-min"
              type="number"
              className="cp-input"
              value={config.minPrice ?? ''}
              onChange={(event) =>
                setConfig({ minPrice: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
          </div>
        </div>
        <div className="col-6">
          <div className="cp-field">
            <label className="cp-label" htmlFor="price-max">
              Maximum price (optional)
            </label>
            <input
              id="price-max"
              type="number"
              className="cp-input"
              value={config.maxPrice ?? ''}
              onChange={(event) =>
                setConfig({ maxPrice: event.target.value === '' ? null : Number(event.target.value) })
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryRuleFields({ config, setConfig }) {
  return (
    <div className="row g-3">
      <div className="col-12 col-md-4">
        <div className="cp-field">
          <label className="cp-label" htmlFor="inv-safety">
            Safety stock
          </label>
          <input
            id="inv-safety"
            type="number"
            min="0"
            className="cp-input"
            value={config.safetyStock ?? 0}
            onChange={(event) => setConfig({ safetyStock: Number(event.target.value) })}
          />
          <span className="cp-help">Held back from every product. Supplier 20 − 3 = Shopify 17.</span>
        </div>
      </div>

      <div className="col-12 col-md-4">
        <div className="cp-field">
          <label className="cp-label" htmlFor="inv-threshold">
            Treat below this as zero
          </label>
          <input
            id="inv-threshold"
            type="number"
            min="0"
            className="cp-input"
            value={config.minThreshold ?? ''}
            onChange={(event) =>
              setConfig({ minThreshold: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
        <label className="cp-checkbox">
          <input
            type="checkbox"
            checked={Boolean(config.zeroOutBelowMin)}
            onChange={(event) => setConfig({ zeroOutBelowMin: event.target.checked })}
          />
          <span>Zero out stock below the threshold</span>
        </label>
      </div>

      <div className="col-12 col-md-4">
        <div className="cp-field">
          <label className="cp-label" htmlFor="inv-max">
            Maximum inventory (optional)
          </label>
          <input
            id="inv-max"
            type="number"
            min="0"
            className="cp-input"
            value={config.maxInventory ?? ''}
            onChange={(event) =>
              setConfig({ maxInventory: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
      </div>

      <div className="col-12 col-md-6">
        <div className="cp-field">
          <label className="cp-label" htmlFor="inv-zero-status">
            When stock reaches zero
          </label>
          <select
            id="inv-zero-status"
            className="cp-select"
            value={config.setStatusWhenZero || ''}
            onChange={(event) => setConfig({ setStatusWhenZero: event.target.value || null })}
          >
            <option value="">Leave the product as it is</option>
            <option value="DRAFT">Set the product to draft</option>
            <option value="ARCHIVED">Archive the product</option>
          </select>
        </div>
      </div>

      <div className="col-12 col-md-6">
        <div className="cp-field">
          <label className="cp-label" htmlFor="inv-stock-status">
            When stock returns
          </label>
          <select
            id="inv-stock-status"
            className="cp-select"
            value={config.setStatusWhenInStock || ''}
            onChange={(event) => setConfig({ setStatusWhenInStock: event.target.value || null })}
          >
            <option value="">Leave the product as it is</option>
            <option value="ACTIVE">Set the product to active</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function CollectionRuleFields({ config, setConfig }) {
  return (
    <div>
      <div className="row g-3">
        <div className="col-12 col-md-6">
          <div className="cp-field">
            <label className="cp-label" htmlFor="col-source">
              Which column decides the collection?
            </label>
            <select
              id="col-source"
              className="cp-select"
              value={config.sourceField}
              onChange={(event) => setConfig({ sourceField: event.target.value })}
            >
              <option value="product.productType">Product type / category</option>
              <option value="product.vendor">Brand / vendor</option>
              <option value="product.collection">Collection column</option>
              <option value="product.tags">Tags</option>
            </select>
          </div>
        </div>
        <div className="col-12 col-md-6">
          <div className="cp-field">
            <label className="cp-label" htmlFor="col-fallback">
              Fallback collection (optional)
            </label>
            <input
              id="col-fallback"
              className="cp-input"
              value={config.fallbackCollection ?? ''}
              onChange={(event) => setConfig({ fallbackCollection: event.target.value || null })}
            />
            <span className="cp-help">Used when the column is empty.</span>
          </div>
        </div>
      </div>

      <div className="cp-field">
        <span className="cp-label">Rename categories on the way in</span>
        <ValueMapEditor
          valueMap={config.valueMap || []}
          onChange={(valueMap) => setConfig({ valueMap })}
        />
        <span className="cp-help">
          Anything not listed here keeps its original name.
        </span>
      </div>

      <label className="cp-checkbox">
        <input
          type="checkbox"
          checked={Boolean(config.createIfMissing)}
          onChange={(event) => setConfig({ createIfMissing: event.target.checked })}
        />
        <span>
          Create collections that do not exist yet
          <span className="cp-help">
            Off by default. When off, a missing collection is reported in the error center instead of
            being created.
          </span>
        </span>
      </label>
    </div>
  );
}

function TagRuleFields({ config, setConfig }) {
  const toggleField = (field) => {
    const current = config.sourceFields || [];
    setConfig({
      sourceFields: current.includes(field)
        ? current.filter((f) => f !== field)
        : [...current, field],
    });
  };

  const options = [
    { key: 'product.vendor', label: 'Brand / vendor' },
    { key: 'product.productType', label: 'Category / product type' },
    { key: 'product.tags', label: 'Tags column' },
    { key: 'product.collection', label: 'Collection column' },
  ];

  return (
    <div>
      <div className="cp-field">
        <span className="cp-label">Build tags from</span>
        {options.map((option) => (
          <label key={option.key} className="cp-checkbox mb-2">
            <input
              type="checkbox"
              checked={(config.sourceFields || []).includes(option.key)}
              onChange={() => toggleField(option.key)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>

      <div className="cp-field">
        <label className="cp-label" htmlFor="tag-static">
          Always add these tags
        </label>
        <input
          id="tag-static"
          className="cp-input"
          placeholder="imported, supplier-a"
          value={(config.staticTags || []).join(', ')}
          onChange={(event) =>
            setConfig({
              staticTags: event.target.value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
        />
      </div>

      <label className="cp-checkbox mb-2">
        <input
          type="checkbox"
          checked={config.lowercase !== false}
          onChange={(event) => setConfig({ lowercase: event.target.checked })}
        />
        <span>Convert tags to lowercase</span>
      </label>

      <label className="cp-checkbox">
        <input
          type="checkbox"
          checked={Boolean(config.replaceExisting)}
          onChange={(event) => setConfig({ replaceExisting: event.target.checked })}
        />
        <span>
          Replace existing tags
          <span className="cp-help">
            Off by default, so tags you added in Shopify are kept alongside the generated ones.
          </span>
        </span>
      </label>
    </div>
  );
}

/** Turns a saved rule row back into the editor's config shape. */
function configFromRule(rule) {
  switch (rule.kind) {
    case 'PRICE':
      return {
        expression: rule.priceRule?.expression,
        targetField: rule.priceRule?.targetField || 'variant.price',
        roundingMode: rule.priceRule?.roundingMode || 'NONE',
        roundingTo: numberOrNull(rule.priceRule?.roundingTo),
        endingValue: numberOrNull(rule.priceRule?.endingValue),
        minPrice: numberOrNull(rule.priceRule?.minPrice),
        maxPrice: numberOrNull(rule.priceRule?.maxPrice),
      };
    case 'INVENTORY':
      return {
        safetyStock: rule.inventoryRule?.safetyStock ?? 0,
        minThreshold: rule.inventoryRule?.minThreshold ?? null,
        zeroOutBelowMin: Boolean(rule.inventoryRule?.zeroOutBelowMin),
        setStatusWhenZero: rule.inventoryRule?.setStatusWhenZero || null,
        setStatusWhenInStock: rule.inventoryRule?.setStatusWhenInStock || null,
        maxInventory: rule.inventoryRule?.maxInventory ?? null,
      };
    case 'COLLECTION':
      return {
        sourceField: rule.collectionRule?.sourceField || 'product.productType',
        createIfMissing: Boolean(rule.collectionRule?.createIfMissing),
        valueMap: rule.collectionRule?.valueMap || [],
        fallbackCollection: rule.collectionRule?.fallbackCollection || null,
      };
    case 'TAG':
      return {
        sourceFields: rule.tagRule?.sourceFields || [],
        staticTags: rule.tagRule?.staticTags || [],
        lowercase: rule.tagRule?.lowercase !== false,
        replaceExisting: Boolean(rule.tagRule?.replaceExisting),
      };
    default:
      return {};
  }
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** One-line plain-English summary shown in the rules table. */
function describeRule(rule) {
  const clauses = rule.conditions?.clauses || [];
  const when = clauses.length
    ? `When ${clauses
        .map((c) => `${c.field.split('.').pop()} ${c.op.replace(/_/g, ' ')} ${c.value ?? ''}`.trim())
        .join(` ${rule.conditions.operator} `)}: `
    : '';

  switch (rule.kind) {
    case 'PRICE': {
      const rounding =
        rule.priceRule?.roundingMode === 'ENDING'
          ? `, ending in ${rule.priceRule.endingValue ?? 99}`
          : rule.priceRule?.roundingMode && rule.priceRule.roundingMode !== 'NONE'
            ? `, rounded ${rule.priceRule.roundingMode.toLowerCase()}`
            : '';
      return `${when}set ${rule.priceRule?.targetField === 'variant.compareAtPrice' ? 'compare-at price' : 'price'} from a formula${rounding}`;
    }
    case 'INVENTORY': {
      const parts = [];
      if (rule.inventoryRule?.safetyStock) parts.push(`hold back ${rule.inventoryRule.safetyStock}`);
      if (rule.inventoryRule?.setStatusWhenZero)
        parts.push(`${rule.inventoryRule.setStatusWhenZero.toLowerCase()} at zero stock`);
      if (rule.inventoryRule?.setStatusWhenInStock)
        parts.push(`${rule.inventoryRule.setStatusWhenInStock.toLowerCase()} when restocked`);
      return `${when}${parts.join(', ') || 'pass supplier stock through'}`;
    }
    case 'COLLECTION': {
      const count = (rule.collectionRule?.valueMap || []).length;
      return `${when}assign collections from ${rule.collectionRule?.sourceField?.split('.').pop()}${count ? ` (${count} renamed)` : ''}`;
    }
    case 'TAG':
      return `${when}tag from ${(rule.tagRule?.sourceFields || []).map((f) => f.split('.').pop()).join(', ') || 'fixed values'}`;
    default:
      return '';
  }
}
