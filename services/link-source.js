import prisma from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { listWorksheets } from './google-sheets.js';
import { fetchCsvUrl } from './url-source.js';
import { suggestMappings } from './mapping-engine.js';
import { saveMappings } from './data-source.js';
import { checkEntitlement } from './billing.js';
import { PlanLimitError } from './job-service.js';
import {
  serviceAccountClient,
  serviceAccountEmail,
  serviceAccountConfigured,
  parseSpreadsheetId,
  translateServiceAccountError,
  ServiceAccountError,
} from '../lib/google/service-account.js';

/**
 * Sources connected by pasting a link, rather than through Google OAuth.
 *
 * Both paths here exist so the product can ship without waiting on Google app
 * verification, which is mandatory for OAuth with sensitive scopes and takes
 * weeks. See README for the trade-offs the merchant is choosing between.
 */

/**
 * Connects a sheet the merchant shared with the service account.
 * The sheet is opened once before saving, so "you have not shared it yet" is
 * reported here rather than on the first sync.
 */
export async function connectSharedSheet({ shopId, link, name }) {
  if (!serviceAccountConfigured()) {
    throw new ServiceAccountError('Shared sheets are not available on this installation.', {
      code: 'service_account_missing',
      suggestion: 'Ask support to enable shared sheet access.',
    });
  }

  const spreadsheetId = parseSpreadsheetId(link);
  if (!spreadsheetId) {
    throw new ServiceAccountError('That does not look like a Google Sheets link.', {
      code: 'invalid_link',
      suggestion: 'Copy the link from your browser while the sheet is open.',
    });
  }

  const existing = await prisma.dataSource.findFirst({
    where: { shopId, kind: 'GOOGLE_SHEET_SERVICE', spreadsheetId },
  });
  if (!existing) await assertCanAddSource(shopId);

  let worksheets;
  let title;
  try {
    ({ worksheets, title } = await listWorksheets(serviceAccountClient(), spreadsheetId));
  } catch (error) {
    throw translateServiceAccountError(error, serviceAccountEmail());
  }

  const data = {
    name: name || title,
    fileUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    lastModifiedAt: new Date(),
    status: 'DRAFT',
  };

  const source = existing
    ? await prisma.dataSource.update({ where: { id: existing.id }, data })
    : await prisma.dataSource.create({
        data: { shopId, kind: 'GOOGLE_SHEET_SERVICE', spreadsheetId, ...data },
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

  logger.info('source.shared_sheet_connected', { shopId, dataSourceId: source.id });
  return { source, worksheets };
}

/**
 * Connects a published CSV link.
 *
 * The file is downloaded once to prove the link works and to read its headers.
 * Rows are re-downloaded on every run, so the sheet stays the source of truth.
 */
export async function connectCsvUrl({ shopId, url, name }) {
  const existing = await prisma.dataSource.findFirst({
    where: { shopId, kind: 'CSV_URL', fileUrl: url },
  });
  if (!existing) await assertCanAddSource(shopId);

  const { headers, rows, worksheetName } = await fetchCsvUrl(url);

  const data = {
    name: name || deriveName(url),
    fileUrl: url,
    lastModifiedAt: new Date(),
    status: 'DRAFT',
  };

  const source = existing
    ? await prisma.dataSource.update({ where: { id: existing.id }, data })
    : await prisma.dataSource.create({ data: { shopId, kind: 'CSV_URL', ...data } });

  await prisma.$transaction([
    prisma.dataSourceSheet.deleteMany({ where: { dataSourceId: source.id } }),
    prisma.dataSourceSheet.create({
      data: {
        dataSourceId: source.id,
        sheetId: '0',
        title: worksheetName,
        headerRow: 1,
        headers,
        rowCount: rows.length,
        columnCount: headers.length,
        isSelected: true,
      },
    }),
  ]);

  const existingMappings = await prisma.columnMapping.findMany({ where: { dataSourceId: source.id } });
  const suggestions = suggestMappings(headers, { existing: existingMappings });
  await saveMappings({ shopId, dataSourceId: source.id, mappings: suggestions, markConfirmed: false });

  logger.info('source.csv_url_connected', { shopId, dataSourceId: source.id, rows: rows.length });

  return {
    source,
    headers,
    rowCount: rows.length,
    sample: rows.slice(0, 5).map((row) => row.cells),
  };
}

async function assertCanAddSource(shopId) {
  const entitlement = await checkEntitlement(shopId, 'add_source');
  if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);
}

function deriveName(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('docs.google.com')) return 'Published Google Sheet';
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last || parsed.hostname;
  } catch {
    return 'Linked CSV';
  }
}
