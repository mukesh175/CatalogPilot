import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import prisma from '../lib/prisma.js';
import { hashRow } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { dedupeHeaders } from './google-sheets.js';
import { suggestMappings } from './mapping-engine.js';
import { saveMappings } from './data-source.js';
import { checkEntitlement } from './billing.js';
import { PlanLimitError } from './job-service.js';

/**
 * CSV and Excel sources.
 *
 * Uploaded files are parsed once and staged in UploadedRow, so the sync engine
 * reads them through the same row interface it uses for Google Sheets. Staging
 * rather than re-parsing on every run also means a preview and the sync it
 * approves are guaranteed to see identical data.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ROWS = 100_000;

export class FileImportError extends Error {
  constructor(message, suggestion) {
    super(message);
    this.name = 'FileImportError';
    this.suggestion = suggestion;
  }
}

/** Parses an uploaded file into { headers, rows } without touching the database. */
export async function parseUpload({ buffer, filename }) {
  const extension = String(filename || '').split('.').pop()?.toLowerCase();

  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new FileImportError(
      'That file is larger than 20MB.',
      'Split the file, or connect the spreadsheet through Google Sheets instead.'
    );
  }

  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    return parseCsv(buffer, extension === 'tsv' ? '\t' : undefined);
  }
  if (extension === 'xlsx' || extension === 'xlsm') {
    return parseExcel(buffer);
  }

  throw new FileImportError(
    `CatalogPilot cannot read “.${extension}” files.`,
    'Upload a .csv or .xlsx file, or connect the sheet from Google Sheets.'
  );
}

function parseCsv(buffer, delimiter) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse(text, {
    delimiter: delimiter || '',
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });

  if (!parsed.data?.length) {
    throw new FileImportError('That file has no rows.', 'Check the file opens correctly in a spreadsheet app.');
  }

  const headers = dedupeHeaders((parsed.data[0] || []).map((h) => String(h ?? '').trim()));
  const rows = parsed.data
    .slice(1, MAX_ROWS + 1)
    .map((cells, index) => buildRow(cells, headers.length, index + 2))
    .filter(Boolean);

  return { headers, rows, worksheetName: 'Sheet1' };
}

async function parseExcel(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new FileImportError('That workbook has no worksheets.', 'Check the file and upload it again.');
  }

  const rawRows = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    // ExcelJS row values are 1-indexed with a leading empty slot.
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rawRows.push(values.map(cellToString));
  });

  if (rawRows.length === 0) {
    throw new FileImportError('That worksheet is empty.', 'Add a header row and some products, then upload again.');
  }

  const headers = dedupeHeaders((rawRows[0] || []).map((h) => String(h ?? '').trim()));
  const rows = rawRows
    .slice(1, MAX_ROWS + 1)
    .map((cells, index) => buildRow(cells, headers.length, index + 2))
    .filter(Boolean);

  return { headers, rows, worksheetName: worksheet.name || 'Sheet1' };
}

/** Excel cells can be rich text, formulas, dates or hyperlinks. */
function cellToString(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (value.text) return String(value.text);
    if (value.result != null) return String(value.result);
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    if (value.hyperlink) return String(value.hyperlink);
    return '';
  }
  return String(value).trim();
}

function buildRow(cells, width, rowNumber) {
  const padded = Array.from({ length: width }, (_, i) => {
    const cell = cells?.[i];
    return cell == null ? '' : String(cell).trim();
  });
  if (padded.every((cell) => cell === '')) return null;
  return { rowNumber, cells: padded, hash: hashRow(padded) };
}

/**
 * Creates (or replaces) a file-backed data source and stages its rows.
 * Replacing an existing upload keeps the source id, so its mappings, rules and
 * product mappings all survive a refreshed supplier file.
 */
export async function importFile({ shopId, filename, buffer, dataSourceId = null }) {
  const { headers, rows, worksheetName } = await parseUpload({ buffer, filename });

  if (headers.length === 0) {
    throw new FileImportError(
      'The first row of that file has no column names.',
      'Put your column headings in row 1, then upload again.'
    );
  }

  const existing = dataSourceId
    ? await prisma.dataSource.findFirst({ where: { id: dataSourceId, shopId } })
    : await prisma.dataSource.findFirst({ where: { shopId, name: filename, kind: { in: ['CSV', 'EXCEL'] } } });

  if (!existing) {
    const entitlement = await checkEntitlement(shopId, 'add_source');
    if (!entitlement.allowed) throw new PlanLimitError(entitlement.reason, entitlement.upgradeTo);
  }

  const kind = filename.toLowerCase().endsWith('.csv') ? 'CSV' : 'EXCEL';

  const source = existing
    ? await prisma.dataSource.update({
        where: { id: existing.id },
        data: { name: filename, kind, lastModifiedAt: new Date() },
      })
    : await prisma.dataSource.create({
        data: { shopId, kind, name: filename, status: 'DRAFT', lastModifiedAt: new Date() },
      });

  await prisma.$transaction([
    prisma.uploadedRow.deleteMany({ where: { dataSourceId: source.id } }),
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

  // Chunked so a large file does not build one enormous INSERT.
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.uploadedRow.createMany({
      data: rows.slice(i, i + 500).map((row) => ({
        dataSourceId: source.id,
        rowNumber: row.rowNumber,
        cells: row.cells,
        hash: row.hash,
      })),
      skipDuplicates: true,
    });
  }

  const existingMappings = await prisma.columnMapping.findMany({ where: { dataSourceId: source.id } });
  const suggestions = suggestMappings(headers, { existing: existingMappings });
  await saveMappings({ shopId, dataSourceId: source.id, mappings: suggestions, markConfirmed: false });

  logger.info('source.file_imported', { shopId, dataSourceId: source.id, rows: rows.length, kind });

  return {
    source,
    headers,
    rowCount: rows.length,
    sample: rows.slice(0, 5).map((row) => row.cells),
  };
}

/** Async generator over staged rows, matching the Google Sheets row shape. */
export async function* streamUploadedRows(dataSourceId) {
  let cursor = 0;
  for (;;) {
    const batch = await prisma.uploadedRow.findMany({
      where: { dataSourceId, rowNumber: { gt: cursor } },
      orderBy: { rowNumber: 'asc' },
      take: 500,
    });
    if (batch.length === 0) return;
    for (const row of batch) {
      yield { rowNumber: row.rowNumber, cells: row.cells, hash: row.hash };
    }
    cursor = batch[batch.length - 1].rowNumber;
  }
}
