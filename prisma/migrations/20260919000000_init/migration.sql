-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'FROZEN', 'DECLINED');

-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('GOOGLE_SHEET', 'CSV', 'EXCEL');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('DRAFT', 'READY', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncSchedule" AS ENUM ('MANUAL', 'HOURLY', 'EVERY_6_HOURS', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "MappingConfidence" AS ENUM ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('PREVIEW', 'SYNC');

-- CreateEnum
CREATE TYPE "ItemAction" AS ENUM ('CREATE', 'UPDATE', 'UNCHANGED', 'SKIP', 'ERROR');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('PENDING', 'APPLIED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ErrorKind" AS ENUM ('VALIDATION', 'MAPPING', 'IMAGE', 'RATE_LIMIT', 'SHOPIFY_API', 'GOOGLE_API', 'PERMISSION', 'PLAN_LIMIT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('PRICE', 'INVENTORY', 'COLLECTION', 'TAG', 'VENDOR', 'STATUS');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "countryCode" TEXT,
    "currencyCode" TEXT NOT NULL DEFAULT 'USD',
    "primaryLocationId" TEXT,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "onboardingDone" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyUserId" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "locale" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifySession" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT,
    "scope" TEXT,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "onlineUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "userId" TEXT,
    "googleUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSource" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "googleConnectionId" TEXT,
    "kind" "DataSourceKind" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "spreadsheetId" TEXT,
    "fileUrl" TEXT,
    "lastModifiedAt" TIMESTAMP(3),
    "schedule" "SyncSchedule" NOT NULL DEFAULT 'MANUAL',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "isPaused" BOOLEAN NOT NULL DEFAULT false,
    "allowBlankOverwrite" BOOLEAN NOT NULL DEFAULT false,
    "allowStatusChange" BOOLEAN NOT NULL DEFAULT true,
    "allowImageUpdate" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceSheet" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sheetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "columnCount" INTEGER NOT NULL DEFAULT 0,
    "headers" JSONB NOT NULL DEFAULT '[]',
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSourceSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedRow" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "cells" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ColumnMapping" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "sourceColumn" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "confidence" "MappingConfidence" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "isIgnored" BOOLEAN NOT NULL DEFAULT false,
    "transform" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ColumnMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "kind" "RuleKind" NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "conditions" JSONB NOT NULL DEFAULT '{"operator":"AND","clauses":[]}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "expression" JSONB NOT NULL,
    "targetField" TEXT NOT NULL DEFAULT 'variant.price',
    "roundingMode" TEXT,
    "roundingTo" DECIMAL(12,2),
    "endingValue" DECIMAL(12,2),
    "minPrice" DECIMAL(12,2),
    "maxPrice" DECIMAL(12,2),

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryRule" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "safetyStock" INTEGER NOT NULL DEFAULT 0,
    "minThreshold" INTEGER,
    "zeroOutBelowMin" BOOLEAN NOT NULL DEFAULT false,
    "setStatusWhenZero" "ProductStatus",
    "setStatusWhenInStock" "ProductStatus",
    "maxInventory" INTEGER,

    CONSTRAINT "InventoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionRule" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL DEFAULT 'category',
    "createIfMissing" BOOLEAN NOT NULL DEFAULT false,
    "valueMap" JSONB NOT NULL DEFAULT '[]',
    "fallbackCollection" TEXT,

    CONSTRAINT "CollectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagRule" (
    "id" TEXT NOT NULL,
    "syncRuleId" TEXT NOT NULL,
    "sourceFields" JSONB NOT NULL DEFAULT '[]',
    "staticTags" JSONB NOT NULL DEFAULT '[]',
    "lowercase" BOOLEAN NOT NULL DEFAULT true,
    "replaceExisting" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TagRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL DEFAULT 'SYNC',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "planCompletedAt" TIMESTAMP(3),
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "triggeredBy" TEXT NOT NULL DEFAULT 'manual',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncJobItem" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rowHash" TEXT NOT NULL,
    "sku" TEXT,
    "handle" TEXT,
    "title" TEXT,
    "action" "ItemAction" NOT NULL DEFAULT 'UNCHANGED',
    "status" "ItemStatus" NOT NULL DEFAULT 'PENDING',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncJobItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncError" (
    "id" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "syncJobItemId" TEXT,
    "kind" "ErrorKind" NOT NULL DEFAULT 'UNKNOWN',
    "code" TEXT,
    "message" TEXT NOT NULL,
    "suggestion" TEXT,
    "field" TEXT,
    "sku" TEXT,
    "rowNumber" INTEGER,
    "productTitle" TEXT,
    "detail" JSONB,
    "isRetryable" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncHistory" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "syncJobId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "scanned" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL,
    "triggeredBy" TEXT NOT NULL,

    CONSTRAINT "SyncHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "dataSourceId" TEXT,
    "externalKey" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "handle" TEXT,
    "lastRowHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariantMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productMappingId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "lastRowHash" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionMapping" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "shopifyCollectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdByApp" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSubscription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "shopifyChargeId" TEXT,
    "confirmationUrl" TEXT,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "email" TEXT,
    "onSyncCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onSyncFailed" BOOLEAN NOT NULL DEFAULT true,
    "onAttentionRequired" BOOLEAN NOT NULL DEFAULT true,
    "onConnectionExpired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_domain_key" ON "Shop"("domain");

-- CreateIndex
CREATE INDEX "Shop_isActive_idx" ON "Shop"("isActive");

-- CreateIndex
CREATE INDEX "User_shopId_idx" ON "User"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "User_shopId_shopifyUserId_key" ON "User"("shopId", "shopifyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifySession_sessionId_key" ON "ShopifySession"("sessionId");

-- CreateIndex
CREATE INDEX "ShopifySession_shopId_isOnline_idx" ON "ShopifySession"("shopId", "isOnline");

-- CreateIndex
CREATE INDEX "GoogleConnection_shopId_isRevoked_idx" ON "GoogleConnection"("shopId", "isRevoked");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConnection_shopId_googleUserId_key" ON "GoogleConnection"("shopId", "googleUserId");

-- CreateIndex
CREATE INDEX "DataSource_shopId_status_idx" ON "DataSource"("shopId", "status");

-- CreateIndex
CREATE INDEX "DataSource_nextRunAt_isPaused_idx" ON "DataSource"("nextRunAt", "isPaused");

-- CreateIndex
CREATE UNIQUE INDEX "DataSource_shopId_kind_spreadsheetId_key" ON "DataSource"("shopId", "kind", "spreadsheetId");

-- CreateIndex
CREATE INDEX "DataSourceSheet_dataSourceId_isSelected_idx" ON "DataSourceSheet"("dataSourceId", "isSelected");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceSheet_dataSourceId_sheetId_key" ON "DataSourceSheet"("dataSourceId", "sheetId");

-- CreateIndex
CREATE INDEX "UploadedRow_dataSourceId_rowNumber_idx" ON "UploadedRow"("dataSourceId", "rowNumber");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedRow_dataSourceId_rowNumber_key" ON "UploadedRow"("dataSourceId", "rowNumber");

-- CreateIndex
CREATE INDEX "ColumnMapping_dataSourceId_isConfirmed_idx" ON "ColumnMapping"("dataSourceId", "isConfirmed");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_dataSourceId_sourceColumn_key" ON "ColumnMapping"("dataSourceId", "sourceColumn");

-- CreateIndex
CREATE UNIQUE INDEX "ColumnMapping_dataSourceId_targetField_key" ON "ColumnMapping"("dataSourceId", "targetField");

-- CreateIndex
CREATE INDEX "SyncRule_shopId_kind_isEnabled_idx" ON "SyncRule"("shopId", "kind", "isEnabled");

-- CreateIndex
CREATE INDEX "SyncRule_dataSourceId_kind_priority_idx" ON "SyncRule"("dataSourceId", "kind", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "PriceRule_syncRuleId_key" ON "PriceRule"("syncRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryRule_syncRuleId_key" ON "InventoryRule"("syncRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionRule_syncRuleId_key" ON "CollectionRule"("syncRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "TagRule_syncRuleId_key" ON "TagRule"("syncRuleId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJob_idempotencyKey_key" ON "SyncJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SyncJob_shopId_status_createdAt_idx" ON "SyncJob"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_dataSourceId_kind_createdAt_idx" ON "SyncJob"("dataSourceId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_status_lockedAt_idx" ON "SyncJob"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "SyncJobItem_syncJobId_action_idx" ON "SyncJobItem"("syncJobId", "action");

-- CreateIndex
CREATE INDEX "SyncJobItem_syncJobId_status_idx" ON "SyncJobItem"("syncJobId", "status");

-- CreateIndex
CREATE INDEX "SyncJobItem_syncJobId_sku_idx" ON "SyncJobItem"("syncJobId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "SyncJobItem_syncJobId_rowNumber_key" ON "SyncJobItem"("syncJobId", "rowNumber");

-- CreateIndex
CREATE INDEX "SyncError_syncJobId_resolvedAt_idx" ON "SyncError"("syncJobId", "resolvedAt");

-- CreateIndex
CREATE INDEX "SyncError_syncJobId_kind_idx" ON "SyncError"("syncJobId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "SyncHistory_syncJobId_key" ON "SyncHistory"("syncJobId");

-- CreateIndex
CREATE INDEX "SyncHistory_shopId_startedAt_idx" ON "SyncHistory"("shopId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncHistory_dataSourceId_startedAt_idx" ON "SyncHistory"("dataSourceId", "startedAt");

-- CreateIndex
CREATE INDEX "ProductMapping_shopId_lastSyncedAt_idx" ON "ProductMapping"("shopId", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shopId_externalKey_key" ON "ProductMapping"("shopId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMapping_shopId_shopifyProductId_key" ON "ProductMapping"("shopId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "VariantMapping_productMappingId_idx" ON "VariantMapping"("productMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMapping_shopId_sku_key" ON "VariantMapping"("shopId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "VariantMapping_shopId_shopifyVariantId_key" ON "VariantMapping"("shopId", "shopifyVariantId");

-- CreateIndex
CREATE INDEX "CollectionMapping_shopId_shopifyCollectionId_idx" ON "CollectionMapping"("shopId", "shopifyCollectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionMapping_shopId_sourceValue_key" ON "CollectionMapping"("shopId", "sourceValue");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopId_key" ON "BillingSubscription"("shopId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSubscription_shopifyChargeId_key" ON "BillingSubscription"("shopifyChargeId");

-- CreateIndex
CREATE INDEX "BillingSubscription_status_idx" ON "BillingSubscription"("status");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_shopId_key" ON "NotificationSetting"("shopId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifySession" ADD CONSTRAINT "ShopifySession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSource" ADD CONSTRAINT "DataSource_googleConnectionId_fkey" FOREIGN KEY ("googleConnectionId") REFERENCES "GoogleConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceSheet" ADD CONSTRAINT "DataSourceSheet_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedRow" ADD CONSTRAINT "UploadedRow_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ColumnMapping" ADD CONSTRAINT "ColumnMapping_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRule" ADD CONSTRAINT "SyncRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRule" ADD CONSTRAINT "SyncRule_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryRule" ADD CONSTRAINT "InventoryRule_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionRule" ADD CONSTRAINT "CollectionRule_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagRule" ADD CONSTRAINT "TagRule_syncRuleId_fkey" FOREIGN KEY ("syncRuleId") REFERENCES "SyncRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJobItem" ADD CONSTRAINT "SyncJobItem_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncError" ADD CONSTRAINT "SyncError_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncHistory" ADD CONSTRAINT "SyncHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncHistory" ADD CONSTRAINT "SyncHistory_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncHistory" ADD CONSTRAINT "SyncHistory_syncJobId_fkey" FOREIGN KEY ("syncJobId") REFERENCES "SyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMapping" ADD CONSTRAINT "VariantMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariantMapping" ADD CONSTRAINT "VariantMapping_productMappingId_fkey" FOREIGN KEY ("productMappingId") REFERENCES "ProductMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionMapping" ADD CONSTRAINT "CollectionMapping_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSubscription" ADD CONSTRAINT "BillingSubscription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

