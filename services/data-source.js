import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { listWorksheets, readHeaderAndSample, countRows, getLastModified } from './google-sheets.js';
import { suggestMappings, validateMappingSet } from './mapping-engine.js';
import { checkEntitlement } from './billing.js';
import { PlanLimitError } from './job-service.js';
import { authForSource } from './sheet-auth.js';
import { authorizedClient } from '../lib/google/oauth.js';

/**
 * Data source lifecycle: connect a spreadsheet, pick a worksheet, map columns.
 *
 * Every function takes an explicit shopId and scopes its queries by it. There
 * is no code path that loads a source by id alone, which is what prevents one
 * store reading another store's configuration.
 */

export async function listSources(shopId) {
  const sources = await prisma.dataSource.findMany({
    where: { shopId },
    orderBy: { createdAt: 'desc' },
    include: {
      googleConnection: { select: { id: true, email: true, isRevoked: true } },
      sheets: { where: { isSelected: true }, take: 1 },
      _count: { select: { mappings: true, rules: true } },
      history: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.kind,
    status: source.status,
    spreadsheetId: source.spreadsheetId,
    fileUrl: source.fileUrl,
    schedule: source.schedule,
    isPaused: source.isPaused,
    nextRunAt: source.nextRunAt,
    lastRunAt: source.lastRunAt,
    worksheet: source.sheets[0]
      ? { title: source.sheets[0].title, rowCount: source.sheets[0].rowCount }
      : null,
    connection: source.googleConnection,
    mappingCount: source._count.mappings,
    ruleCount: source._count.rules,
    lastSync: source.history[0] || null,
    settings: {
      allowBlankOverwrite: source.allowBlankOverwrite,
      allowStatusChange: source.allowStatusChange,
      allowImageUpdate: source.allowImageUpdate,
    },
  }));
}

export async function getSource(shopId, id) {
  return prisma.dataSource.findFirst({
    where: { id, shopId },
    include: {
      googleConnection: true,
      sheets: { orderBy: { title: 'asc' } },
      mappings: { orderBy: { sourceColumn: 'asc' } },
    },
  });
}

/** Connects a spreadsheet, creating or reusing the source record. */
export async function connectSpreadsheet({ shopId, spreadsheetId, name, url, modifiedAt }) {
  const existing = await prisma.dataSource.findFirst({
    where: { shopId, kind: 'GOOGLE_SHEET', spreadsheetId },
  });

  if (!existing) {
    const entitlement = await checkEntitlement(shopId, 'add_source');
    if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);
  }

  const connection = await prisma.googleConnection.findFirst({
    where: { shopId, isRevoked: false },
    orderBy: { createdAt: 'desc' },
  });
  if (!connection) throw new Error('Connect a Google account before adding a spreadsheet');

  // Confirm the account can actually open the file before saving it, so a
  // source never lands in a state where every sync fails on permissions.
  const { worksheets, title } = await listWorksheets(await authorizedClient(connection), spreadsheetId);

  const data = {
    name: name || title,
    fileUrl: url || null,
    lastModifiedAt: modifiedAt ? new Date(modifiedAt) : null,
    googleConnectionId: connection.id,
    status: 'DRAFT',
  };

  const source = existing
    ? await prisma.dataSource.update({ where: { id: existing.id }, data })
    : await prisma.dataSource.create({
        data: { shopId, kind: 'GOOGLE_SHEET', spreadsheetId, ...data },
      });

  await prisma.$transaction(
    worksheets.map((sheet) =>
      prisma.dataSourceSheet.upsert({
        where: { dataSourceId_sheetId: { dataSourceId: source.id, sheetId: sheet.sheetId } },
        create: {
          dataSourceId: source.id,
          sheetId: sheet.sheetId,
          title: sheet.title,
          rowCount: sheet.rowCount,
          columnCount: sheet.columnCount,
        },
        update: { title: sheet.title, rowCount: sheet.rowCount, columnCount: sheet.columnCount },
      })
    )
  );

  logger.info('source.connected', { shopId, dataSourceId: source.id, worksheets: worksheets.length });
  return { source, worksheets };
}

/**
 * Selects a worksheet, reads its headers, and produces mapping suggestions.
 * Suggestions are saved so the merchant's review screen and the sync engine
 * read from the same records.
 */
export async function selectWorksheet({ shopId, dataSourceId, sheetId, title, headerRow = 1 }) {
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    include: { googleConnection: true, mappings: true },
  });
  if (!source) throw new Error('That data source does not exist');
  // Resolves to the merchant OAuth client or the shared-sheet service
  // account, depending on how this source was connected.
  const auth = await authForSource(source);

  const { headers, sample } = await readHeaderAndSample(auth, {
    spreadsheetId: source.spreadsheetId,
    sheetTitle: title,
    headerRow,
  });

  if (headers.length === 0) {
    throw new Error(`Row ${headerRow} of "${title}" is empty, so there are no column names to map`);
  }

  const rowCount = await countRows(auth, {
    spreadsheetId: source.spreadsheetId,
    sheetTitle: title,
    headerRow,
  });

  await prisma.$transaction([
    prisma.dataSourceSheet.updateMany({ where: { dataSourceId }, data: { isSelected: false } }),
    prisma.dataSourceSheet.upsert({
      where: { dataSourceId_sheetId: { dataSourceId, sheetId } },
      create: { dataSourceId, sheetId, title, headerRow, headers, rowCount, isSelected: true },
      update: { title, headerRow, headers, rowCount, isSelected: true },
    }),
  ]);

  const suggestions = suggestMappings(headers, { existing: source.mappings });
  await saveMappings({ shopId, dataSourceId, mappings: suggestions, markConfirmed: false });

  return { headers, sample, rowCount, suggestions: await loadMappings(shopId, dataSourceId) };
}

/**
 * Persists column mappings.
 *
 * Replacing the whole set in one transaction avoids the half-applied state a
 * per-row update would leave behind if one row violated the unique constraint
 * that stops two columns claiming the same Shopify field.
 */
export async function saveMappings({ shopId, dataSourceId, mappings, markConfirmed = true }) {
  const source = await prisma.dataSource.findFirst({ where: { id: dataSourceId, shopId } });
  if (!source) throw new Error('That data source does not exist');

  const seenTargets = new Set();
  const rows = [];

  for (const mapping of mappings) {
    if (!mapping.targetField || mapping.isIgnored) continue;
    if (seenTargets.has(mapping.targetField)) {
      throw new Error(
        `Two columns are both mapped to ${mapping.targetField}. Each Shopify field can only be filled once.`
      );
    }
    seenTargets.add(mapping.targetField);
    rows.push({
      dataSourceId,
      sourceColumn: mapping.sourceColumn,
      normalized: mapping.normalized || mapping.sourceColumn.toLowerCase(),
      targetField: mapping.targetField,
      confidence: mapping.confidence || 'NEEDS_REVIEW',
      score: mapping.score ?? 0,
      isConfirmed: markConfirmed ? true : Boolean(mapping.isConfirmed),
      isIgnored: false,
    });
  }

  await prisma.$transaction([
    prisma.columnMapping.deleteMany({ where: { dataSourceId } }),
    prisma.columnMapping.createMany({ data: rows }),
  ]);

  const validation = validateMappingSet(rows);
  await prisma.dataSource.update({
    where: { id: dataSourceId },
    data: { status: validation.ok ? 'READY' : 'DRAFT' },
  });

  logger.info('source.mappings_saved', { shopId, dataSourceId, count: rows.length, ready: validation.ok });
  return { saved: rows.length, validation };
}

export async function loadMappings(shopId, dataSourceId) {
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    include: {
      mappings: { orderBy: { sourceColumn: 'asc' } },
      sheets: { where: { isSelected: true }, take: 1 },
    },
  });
  if (!source) return null;

  const headers = Array.isArray(source.sheets[0]?.headers) ? source.sheets[0].headers : [];
  const saved = source.mappings;

  // Re-run the suggester so columns added to the sheet since the last visit
  // appear, while confirmed choices stay put.
  const merged = suggestMappings(headers, { existing: saved });

  return merged.map((suggestion) => {
    const stored = saved.find((m) => m.sourceColumn === suggestion.sourceColumn);
    return {
      ...suggestion,
      id: stored?.id || null,
      isConfirmed: stored?.isConfirmed ?? suggestion.isConfirmed,
      isIgnored: stored?.isIgnored ?? false,
      targetField: stored?.targetField ?? suggestion.targetField,
      confidence: stored?.confidence ?? suggestion.confidence,
      score: stored?.score ?? suggestion.score,
    };
  });
}

/** Refreshes cached sheet metadata (row count, modified time). */
export async function refreshSource({ shopId, dataSourceId }) {
  const source = await prisma.dataSource.findFirst({
    where: { id: dataSourceId, shopId },
    include: { googleConnection: true, sheets: { where: { isSelected: true }, take: 1 } },
  });
  if (!source?.sheets[0]) return null;
  // Only the Google-backed kinds have live metadata to re-read; an uploaded
  // file's counts are fixed until it is uploaded again.
  if (source.kind !== 'GOOGLE_SHEET' && source.kind !== 'GOOGLE_SHEET_SERVICE') return null;

  const auth = await authForSource(source);

  // A service account has no Drive access, so the modified time is only
  // available on the OAuth path. Its absence is not an error.
  const [modifiedAt, rowCount] = await Promise.all([
    source.kind === 'GOOGLE_SHEET'
      ? getLastModified(auth, source.spreadsheetId).catch(() => null)
      : Promise.resolve(null),
    countRows(auth, {
      spreadsheetId: source.spreadsheetId,
      sheetTitle: source.sheets[0].title,
      headerRow: source.sheets[0].headerRow,
    }),
  ]);

  await prisma.$transaction([
    prisma.dataSource.update({
      where: { id: dataSourceId },
      data: { lastModifiedAt: modifiedAt ?? source.lastModifiedAt },
    }),
    prisma.dataSourceSheet.update({ where: { id: source.sheets[0].id }, data: { rowCount } }),
  ]);

  return { modifiedAt, rowCount };
}

/**
 * Disconnects a source.
 * The Shopify products it created are deliberately left alone — removing a
 * source stops future syncs, it does not undo the catalog.
 */
export async function disconnectSource({ shopId, dataSourceId }) {
  const source = await prisma.dataSource.findFirst({ where: { id: dataSourceId, shopId } });
  if (!source) return null;

  await prisma.dataSource.delete({ where: { id: dataSourceId } });
  logger.info('source.disconnected', { shopId, dataSourceId });
  return source;
}
