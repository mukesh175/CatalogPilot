import { google } from 'googleapis';
import { authorizedClient, translateGoogleError } from '../lib/google/oauth.js';
import { hashRow } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';

/**
 * Google Sheets access.
 *
 * Rows are streamed in pages and never materialized in full for the browser —
 * the API routes only ever return a bounded sample. Large syncs iterate here
 * inside the worker.
 */

const ROW_PAGE_SIZE = 500;
const MAX_COLUMNS = 200;

/** Lists spreadsheets the connected account can open, newest first. */
export async function listSpreadsheets(connection, { pageToken, query } = {}) {
  try {
    const auth = await authorizedClient(connection);
    const drive = google.drive({ version: 'v3', auth });

    const nameFilter = query ? ` and name contains '${escapeDriveQuery(query)}'` : '';
    const { data } = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false${nameFilter}`,
      fields: 'nextPageToken, files(id, name, modifiedTime, webViewLink, owners(displayName))',
      orderBy: 'modifiedTime desc',
      pageSize: 25,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return {
      files: (data.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        modifiedAt: file.modifiedTime,
        url: file.webViewLink,
        owner: file.owners?.[0]?.displayName || null,
      })),
      nextPageToken: data.nextPageToken || null,
    };
  } catch (error) {
    throw translateGoogleError(error);
  }
}

// Drive query strings are single-quoted; escaping quotes and backslashes keeps
// a spreadsheet named "Bob's" from breaking (or altering) the query.
function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").slice(0, 100);
}

/** Returns worksheet metadata for a spreadsheet. */
export async function listWorksheets(connection, spreadsheetId) {
  try {
    const auth = await authorizedClient(connection);
    const sheets = google.sheets({ version: 'v4', auth });

    const { data } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))',
    });

    return {
      title: data.properties?.title || 'Untitled spreadsheet',
      worksheets: (data.sheets || []).map((sheet) => ({
        sheetId: String(sheet.properties.sheetId),
        title: sheet.properties.title,
        rowCount: sheet.properties.gridProperties?.rowCount || 0,
        columnCount: sheet.properties.gridProperties?.columnCount || 0,
      })),
    };
  } catch (error) {
    throw translateGoogleError(error);
  }
}

/**
 * Reads the header row plus a small sample of data rows.
 * Used by the mapping step — never for the sync itself.
 */
export async function readHeaderAndSample(connection, { spreadsheetId, sheetTitle, headerRow = 1, sampleSize = 5 }) {
  try {
    const auth = await authorizedClient(connection);
    const sheets = google.sheets({ version: 'v4', auth });

    const lastRow = headerRow + sampleSize;
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheet(sheetTitle)}!A${headerRow}:${columnLetter(MAX_COLUMNS)}${lastRow}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });

    const values = data.values || [];
    const headers = dedupeHeaders((values[0] || []).map((h) => String(h ?? '').trim()));
    const sample = values.slice(1).map((row) => padRow(row, headers.length));

    return { headers, sample };
  } catch (error) {
    throw translateGoogleError(error);
  }
}

/**
 * Async generator over every data row in a worksheet.
 *
 * Yields { rowNumber, cells, hash } so callers can skip unchanged rows without
 * holding the sheet in memory.
 */
export async function* streamRows(connection, { spreadsheetId, sheetTitle, headerRow = 1, headerCount }) {
  const auth = await authorizedClient(connection);
  const sheets = google.sheets({ version: 'v4', auth });
  const lastColumn = columnLetter(Math.min(headerCount || MAX_COLUMNS, MAX_COLUMNS));

  let start = headerRow + 1;
  for (;;) {
    const end = start + ROW_PAGE_SIZE - 1;
    let data;
    try {
      ({ data } = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${quoteSheet(sheetTitle)}!A${start}:${lastColumn}${end}`,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      }));
    } catch (error) {
      throw translateGoogleError(error);
    }

    const rows = data.values || [];
    if (rows.length === 0) return;

    for (let i = 0; i < rows.length; i += 1) {
      const cells = padRow(rows[i], headerCount || rows[i].length);
      // Entirely blank rows are separators in most supplier sheets, not data.
      if (cells.every((c) => c === '' || c == null)) continue;
      yield { rowNumber: start + i, cells, hash: hashRow(cells) };
    }

    if (rows.length < ROW_PAGE_SIZE) return;
    start += ROW_PAGE_SIZE;
  }
}

/** Counts data rows without transferring cell contents. */
export async function countRows(connection, { spreadsheetId, sheetTitle, headerRow = 1 }) {
  try {
    const auth = await authorizedClient(connection);
    const sheets = google.sheets({ version: 'v4', auth });
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${quoteSheet(sheetTitle)}!A${headerRow}:A`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
    return Math.max(0, (data.values?.length || 0) - 1);
  } catch (error) {
    throw translateGoogleError(error);
  }
}

/** Writes a column of values back to the sheet (used by write-back features). */
export async function writeColumn(connection, { spreadsheetId, sheetTitle, column, startRow, values }) {
  try {
    const auth = await authorizedClient(connection);
    const sheets = google.sheets({ version: 'v4', auth });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${quoteSheet(sheetTitle)}!${column}${startRow}:${column}${startRow + values.length - 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: values.map((v) => [v]) },
    });
    logger.info('google.write_back', { spreadsheetId, column, rows: values.length });
  } catch (error) {
    throw translateGoogleError(error);
  }
}

/** Returns the file's last modified timestamp, for incremental scheduling. */
export async function getLastModified(connection, spreadsheetId) {
  try {
    const auth = await authorizedClient(connection);
    const drive = google.drive({ version: 'v3', auth });
    const { data } = await drive.files.get({
      fileId: spreadsheetId,
      fields: 'modifiedTime',
      supportsAllDrives: true,
    });
    return data.modifiedTime ? new Date(data.modifiedTime) : null;
  } catch (error) {
    throw translateGoogleError(error);
  }
}

// ------------------------------------------------------------------ utils

/** A1 notation requires single quotes around titles containing spaces. */
function quoteSheet(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

export function columnLetter(index) {
  let n = index;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters || 'A';
}

function padRow(row, length) {
  const out = new Array(length);
  for (let i = 0; i < length; i += 1) {
    const cell = row?.[i];
    out[i] = cell == null ? '' : typeof cell === 'string' ? cell.trim() : cell;
  }
  return out;
}

/**
 * Supplier sheets routinely repeat or omit header names. Duplicates get a
 * suffix so a mapping can still address each column unambiguously.
 */
export function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = header || `Column ${columnLetter(index + 1)}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}
