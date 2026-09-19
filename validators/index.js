import { z } from 'zod';
import { TARGET_FIELD_MAP } from '../lib/fields.js';
import { CONDITION_OPERATORS } from '../services/rules-engine.js';

/**
 * Request validation.
 *
 * Every mutating route parses its body through one of these. Anything not
 * described here is stripped, so a client cannot smuggle extra fields into a
 * Prisma write — and `shopId` deliberately appears in none of them.
 */

export const cuid = z.string().min(1).max(64);

const targetField = z
  .string()
  .refine((v) => TARGET_FIELD_MAP.has(v), { message: 'Unknown Shopify field' });

// ------------------------------------------------------------- data sources

export const connectSheetSchema = z.object({
  spreadsheetId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  url: z.string().url().optional(),
  modifiedAt: z.string().optional(),
});

/** A sheet shared with the service account: the merchant pastes its link. */
export const connectSharedSheetSchema = z.object({
  link: z.string().min(10).max(500),
  name: z.string().min(1).max(200).optional(),
});

/** A published CSV link. The URL is re-validated server-side before fetching. */
export const connectCsvUrlSchema = z.object({
  url: z.string().url().max(1000),
  name: z.string().min(1).max(200).optional(),
});

export const selectWorksheetSchema = z.object({
  sheetId: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  headerRow: z.number().int().min(1).max(50).default(1),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  schedule: z.enum(['MANUAL', 'HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY']).optional(),
  isPaused: z.boolean().optional(),
  allowBlankOverwrite: z.boolean().optional(),
  allowStatusChange: z.boolean().optional(),
  allowImageUpdate: z.boolean().optional(),
});

// ----------------------------------------------------------------- mappings

export const saveMappingsSchema = z.object({
  mappings: z
    .array(
      z.object({
        sourceColumn: z.string().min(1).max(300),
        targetField: targetField.nullable(),
        confidence: z.enum(['EXACT', 'HIGH', 'MEDIUM', 'LOW', 'NEEDS_REVIEW']).default('NEEDS_REVIEW'),
        score: z.number().min(0).max(1).default(0),
        isConfirmed: z.boolean().default(false),
        isIgnored: z.boolean().default(false),
      })
    )
    .max(300),
});

// -------------------------------------------------------------------- rules

const conditionClause = z.object({
  field: z.string().min(1).max(100),
  op: z.enum(CONDITION_OPERATORS),
  value: z.union([z.string().max(300), z.number(), z.null()]).optional(),
});

const conditions = z.object({
  operator: z.enum(['AND', 'OR']).default('AND'),
  clauses: z.array(conditionClause).max(20).default([]),
  setValue: z.string().max(300).optional(),
});

/** Price expression AST, bounded in depth to keep evaluation cheap. */
const expression = z.lazy(() =>
  z.union([
    z.object({ value: z.union([z.number(), z.string()]) }),
    z.object({ field: z.string().min(1).max(100) }),
    z.object({
      op: z.enum(['+', '-', '*', '/', '%']),
      left: z.lazy(() => expression),
      right: z.lazy(() => expression),
    }),
  ])
);

const baseRule = {
  name: z.string().min(1).max(120),
  priority: z.number().int().min(0).max(10_000).default(100),
  isEnabled: z.boolean().default(true),
  dataSourceId: cuid.nullable().optional(),
  conditions: conditions.default({ operator: 'AND', clauses: [] }),
};

export const priceRuleSchema = z.object({
  ...baseRule,
  kind: z.literal('PRICE'),
  config: z.object({
    expression,
    targetField: z.enum(['variant.price', 'variant.compareAtPrice']).default('variant.price'),
    roundingMode: z.enum(['NONE', 'NEAREST', 'UP', 'DOWN', 'ENDING']).default('NONE'),
    roundingTo: z.number().positive().max(1_000_000).nullable().optional(),
    endingValue: z.number().min(0).max(99).nullable().optional(),
    minPrice: z.number().min(0).max(99_999_999).nullable().optional(),
    maxPrice: z.number().min(0).max(99_999_999).nullable().optional(),
  }),
});

export const inventoryRuleSchema = z.object({
  ...baseRule,
  kind: z.literal('INVENTORY'),
  config: z.object({
    safetyStock: z.number().int().min(0).max(1_000_000).default(0),
    minThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
    zeroOutBelowMin: z.boolean().default(false),
    setStatusWhenZero: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).nullable().optional(),
    setStatusWhenInStock: z.enum(['ACTIVE', 'DRAFT', 'ARCHIVED']).nullable().optional(),
    maxInventory: z.number().int().min(0).max(1_000_000).nullable().optional(),
  }),
});

export const collectionRuleSchema = z.object({
  ...baseRule,
  kind: z.literal('COLLECTION'),
  config: z.object({
    sourceField: z.string().min(1).max(100).default('product.productType'),
    createIfMissing: z.boolean().default(false),
    valueMap: z
      .array(z.object({ from: z.string().min(1).max(200), to: z.string().min(1).max(200) }))
      .max(500)
      .default([]),
    fallbackCollection: z.string().max(200).nullable().optional(),
  }),
});

export const tagRuleSchema = z.object({
  ...baseRule,
  kind: z.literal('TAG'),
  config: z.object({
    sourceFields: z.array(z.string().min(1).max(100)).max(20).default([]),
    staticTags: z.array(z.string().min(1).max(100)).max(50).default([]),
    lowercase: z.boolean().default(true),
    replaceExisting: z.boolean().default(false),
  }),
});

export const overrideRuleSchema = z.object({
  ...baseRule,
  kind: z.enum(['VENDOR', 'STATUS']),
  config: z.object({}).optional(),
});

export const ruleSchema = z.discriminatedUnion('kind', [
  priceRuleSchema,
  inventoryRuleSchema,
  collectionRuleSchema,
  tagRuleSchema,
  overrideRuleSchema,
]);

// --------------------------------------------------------------- sync/jobs

export const startJobSchema = z.object({
  dataSourceId: cuid,
  kind: z.enum(['PREVIEW', 'SYNC']).default('PREVIEW'),
});

export const retryErrorsSchema = z.object({
  errorIds: z.array(cuid).max(500).optional(),
  syncJobId: cuid.optional(),
  mode: z.enum(['selected', 'all', 'compatible']).default('selected'),
});

export const ignoreErrorsSchema = z.object({
  errorIds: z.array(cuid).min(1).max(500),
});

// ---------------------------------------------------------------- settings

export const billingSchema = z.object({
  plan: z.enum(['FREE', 'STARTER', 'GROWTH', 'PRO']),
  test: z.boolean().optional(),
});

export const notificationSchema = z.object({
  email: z.string().email().max(255).nullable().optional(),
  onSyncCompleted: z.boolean().optional(),
  onSyncFailed: z.boolean().optional(),
  onAttentionRequired: z.boolean().optional(),
  onConnectionExpired: z.boolean().optional(),
});

// ------------------------------------------------------------------ paging

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const previewQuerySchema = paginationSchema.extend({
  jobId: cuid,
  action: z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'ERROR', 'ALL']).default('ALL'),
  search: z.string().max(200).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(200),
});
