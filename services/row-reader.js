import { streamRows } from './google-sheets.js';
import { streamUploadedRows } from './file-source.js';
import { fetchCsvUrl } from './url-source.js';
import { authForSource } from './sheet-auth.js';

/**
 * One row interface for every source kind.
 *
 * The sync engine reads through this rather than calling a source-specific
 * reader, so adding a source type does not mean touching the engine.
 */
export async function* readRows(source, sheet) {
  switch (source.kind) {
    case 'GOOGLE_SHEET':
    case 'GOOGLE_SHEET_SERVICE': {
      const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
      yield* streamRows(await authForSource(source), {
        spreadsheetId: source.spreadsheetId,
        sheetTitle: sheet.title,
        headerRow: sheet.headerRow,
        headerCount: headers.length,
      });
      return;
    }

    case 'CSV_URL': {
      // Re-downloaded per run so the published sheet stays the source of
      // truth. Within one job the plan and the apply phase each fetch it, and
      // the apply phase re-plans every row anyway, so a mid-run edit is picked
      // up rather than silently applied from stale data.
      const { rows } = await fetchCsvUrl(source.fileUrl);
      for (const row of rows) yield row;
      return;
    }

    default:
      yield* streamUploadedRows(source.id);
  }
}
