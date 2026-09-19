import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { checkEntitlement } from './billing.js';
import { PlanLimitError } from './job-service.js';
import { evaluateExpression, RuleError } from './rules-engine.js';

/**
 * Persistence for rules.
 *
 * A rule's typed configuration lives in its own table, so writes go through a
 * transaction that keeps SyncRule and its detail row in step. Price formulas
 * are dry-run before saving — a formula that cannot evaluate is rejected at
 * save time rather than failing on row 1,400 of a sync.
 */

const DETAIL_RELATION = {
  PRICE: 'priceRule',
  INVENTORY: 'inventoryRule',
  COLLECTION: 'collectionRule',
  TAG: 'tagRule',
};

export async function listRules({ shopId, kind = null, dataSourceId = null }) {
  return prisma.syncRule.findMany({
    where: {
      shopId,
      ...(kind ? { kind } : {}),
      ...(dataSourceId ? { OR: [{ dataSourceId }, { dataSourceId: null }] } : {}),
    },
    orderBy: [{ kind: 'asc' }, { priority: 'asc' }],
    include: { priceRule: true, inventoryRule: true, collectionRule: true, tagRule: true },
  });
}

/** Rules that apply to a source, used by the sync engine. */
export async function rulesForSource({ shopId, dataSourceId }) {
  return prisma.syncRule.findMany({
    where: { shopId, isEnabled: true, OR: [{ dataSourceId }, { dataSourceId: null }] },
    orderBy: { priority: 'asc' },
    include: { priceRule: true, inventoryRule: true, collectionRule: true, tagRule: true },
  });
}

export async function createRule({ shopId, input }) {
  const entitlement = await checkEntitlement(shopId, 'add_rule');
  if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);

  if (input.dataSourceId) await assertSourceBelongsToShop(shopId, input.dataSourceId);
  if (input.kind === 'PRICE') dryRunPriceRule(input.config);

  const rule = await prisma.syncRule.create({
    data: {
      shopId,
      dataSourceId: input.dataSourceId || null,
      kind: input.kind,
      name: input.name,
      priority: input.priority,
      isEnabled: input.isEnabled,
      conditions: input.conditions,
      ...detailCreate(input),
    },
    include: { priceRule: true, inventoryRule: true, collectionRule: true, tagRule: true },
  });

  logger.info('rule.created', { shopId, ruleId: rule.id, kind: rule.kind });
  return rule;
}

export async function updateRule({ shopId, ruleId, input }) {
  const existing = await prisma.syncRule.findFirst({ where: { id: ruleId, shopId } });
  if (!existing) return null;
  if (input.dataSourceId) await assertSourceBelongsToShop(shopId, input.dataSourceId);
  if (input.kind === 'PRICE') dryRunPriceRule(input.config);

  const relation = DETAIL_RELATION[input.kind];

  const rule = await prisma.syncRule.update({
    where: { id: ruleId },
    data: {
      dataSourceId: input.dataSourceId ?? existing.dataSourceId,
      name: input.name,
      priority: input.priority,
      isEnabled: input.isEnabled,
      conditions: input.conditions,
      ...(relation
        ? { [relation]: { upsert: { create: detailData(input), update: detailData(input) } } }
        : {}),
    },
    include: { priceRule: true, inventoryRule: true, collectionRule: true, tagRule: true },
  });

  logger.info('rule.updated', { shopId, ruleId, kind: rule.kind });
  return rule;
}

export async function deleteRule({ shopId, ruleId }) {
  const { count } = await prisma.syncRule.deleteMany({ where: { id: ruleId, shopId } });
  if (count === 0) return false;
  logger.info('rule.deleted', { shopId, ruleId });
  return true;
}

export async function toggleRule({ shopId, ruleId, isEnabled }) {
  const { count } = await prisma.syncRule.updateMany({
    where: { id: ruleId, shopId },
    data: { isEnabled },
  });
  return count > 0;
}

function detailCreate(input) {
  const relation = DETAIL_RELATION[input.kind];
  if (!relation) return {};
  return { [relation]: { create: detailData(input) } };
}

function detailData(input) {
  const config = input.config || {};
  switch (input.kind) {
    case 'PRICE':
      return {
        expression: config.expression,
        targetField: config.targetField,
        roundingMode: config.roundingMode,
        roundingTo: config.roundingTo ?? null,
        endingValue: config.endingValue ?? null,
        minPrice: config.minPrice ?? null,
        maxPrice: config.maxPrice ?? null,
      };
    case 'INVENTORY':
      return {
        safetyStock: config.safetyStock,
        minThreshold: config.minThreshold ?? null,
        zeroOutBelowMin: config.zeroOutBelowMin,
        setStatusWhenZero: config.setStatusWhenZero ?? null,
        setStatusWhenInStock: config.setStatusWhenInStock ?? null,
        maxInventory: config.maxInventory ?? null,
      };
    case 'COLLECTION':
      return {
        sourceField: config.sourceField,
        createIfMissing: config.createIfMissing,
        valueMap: config.valueMap,
        fallbackCollection: config.fallbackCollection ?? null,
      };
    case 'TAG':
      return {
        sourceFields: config.sourceFields,
        staticTags: config.staticTags,
        lowercase: config.lowercase,
        replaceExisting: config.replaceExisting,
      };
    default:
      return {};
  }
}

/** Evaluates the formula against a sample row so bad rules never get saved. */
function dryRunPriceRule(config) {
  const sample = {
    'variant.cost': 100,
    'variant.price': 150,
    'variant.compareAtPrice': 200,
    'variant.inventoryQuantity': 10,
  };
  try {
    const result = evaluateExpression(config.expression, sample);
    if (!Number.isFinite(result.value)) {
      throw new RuleError('This formula does not produce a number');
    }
  } catch (error) {
    if (error instanceof RuleError) throw error;
    throw new RuleError(`This formula could not be evaluated: ${error.message}`);
  }

  if (config.minPrice != null && config.maxPrice != null && config.minPrice > config.maxPrice) {
    throw new RuleError('The minimum price is higher than the maximum price');
  }
}

async function assertSourceBelongsToShop(shopId, dataSourceId) {
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    select: { id: true },
  });
  if (!source) throw new Error('That data source does not exist');
}
