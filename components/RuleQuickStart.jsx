'use client';

import { useState } from 'react';
import { api } from '../lib/client-api.js';
import { useToast } from './AppProviders.jsx';
import { Card, Badge } from './ui.jsx';

/**
 * Preset rules offered during onboarding.
 *
 * These are real rule records created through the same endpoint the rule
 * builder uses — the presets just prefill it, so nothing here is a shortcut
 * around validation.
 */

const PRESETS = [
  {
    id: 'markup-40',
    title: 'Cost × 1.40',
    description: 'A 40% markup on your supplier cost.',
    build: () => ({
      kind: 'PRICE',
      name: 'Cost x 1.40',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.4 } },
        targetField: 'variant.price',
        roundingMode: 'NONE',
      },
    }),
  },
  {
    id: 'markup-round-99',
    title: 'Cost × 1.40, ending in 99',
    description: 'A 40% markup rounded up to the nearest price ending in 99.',
    build: () => ({
      kind: 'PRICE',
      name: 'Cost x 1.40 rounded to 99',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        expression: { op: '*', left: { field: 'variant.cost' }, right: { value: 1.4 } },
        targetField: 'variant.price',
        roundingMode: 'ENDING',
        endingValue: 99,
      },
    }),
  },
  {
    id: 'safety-stock',
    title: 'Hold back 3 units',
    description: 'Keep a safety buffer so you never oversell.',
    build: () => ({
      kind: 'INVENTORY',
      name: 'Safety stock of 3',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: { safetyStock: 3, zeroOutBelowMin: false },
    }),
  },
  {
    id: 'draft-when-empty',
    title: 'Draft when out of stock',
    description: 'Products drop to draft at zero stock, and go active again when restocked.',
    build: () => ({
      kind: 'INVENTORY',
      name: 'Draft when out of stock',
      priority: 110,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        safetyStock: 0,
        zeroOutBelowMin: false,
        setStatusWhenZero: 'DRAFT',
        setStatusWhenInStock: 'ACTIVE',
      },
    }),
  },
  {
    id: 'category-collections',
    title: 'Category → Collection',
    description: 'Put each product in the collection matching its category.',
    build: () => ({
      kind: 'COLLECTION',
      name: 'Category to collection',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        sourceField: 'product.productType',
        createIfMissing: false,
        valueMap: [],
      },
    }),
  },
  {
    id: 'brand-tags',
    title: 'Tag by brand and category',
    description: 'Adds tags like “nike, shoes” automatically.',
    build: () => ({
      kind: 'TAG',
      name: 'Brand and category tags',
      priority: 100,
      isEnabled: true,
      conditions: { operator: 'AND', clauses: [] },
      config: {
        sourceFields: ['product.vendor', 'product.productType'],
        staticTags: [],
        lowercase: true,
        replaceExisting: false,
      },
    }),
  },
];

export function RuleQuickStart({ sourceId }) {
  const toast = useToast();
  const [added, setAdded] = useState([]);
  const [pending, setPending] = useState(null);

  const addPreset = async (preset) => {
    setPending(preset.id);
    try {
      await api.post('/api/rules', { ...preset.build(), dataSourceId: sourceId || null });
      setAdded((current) => [...current, preset.id]);
      toast.success(`Added “${preset.title}”.`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Card
      title="Set up your rules"
      actions={
        <a href="/automation/price" className="cp-btn cp-btn-sm">
          Build a custom rule
        </a>
      }
    >
      <p className="cp-subdued">
        Pick the policies you want CatalogPilot to apply on every sync. You can change or remove any of
        these later.
      </p>

      <div className="row g-3">
        {PRESETS.map((preset) => {
          const isAdded = added.includes(preset.id);
          return (
            <div key={preset.id} className="col-12 col-md-6">
              <div className="cp-source-card" style={{ cursor: 'default' }}>
                <div className="cp-spread">
                  <strong style={{ fontSize: 13.5 }}>{preset.title}</strong>
                  {isAdded ? <Badge tone="success">Added</Badge> : null}
                </div>
                <span className="cp-subdued" style={{ fontSize: 12.5 }}>
                  {preset.description}
                </span>
                <button
                  type="button"
                  className="cp-btn cp-btn-sm align-self-start mt-2"
                  onClick={() => addPreset(preset)}
                  disabled={isAdded || pending === preset.id}
                >
                  {isAdded ? 'Added' : pending === preset.id ? 'Adding…' : 'Add rule'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
