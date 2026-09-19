import { streamRows } from './google-sheets.js';
import { streamUploadedRows } from './file-source.js';

/**
 * One row interface for every source kind.
 *
 * The sync engine reads through this rather than calling a source-specific
 * reader, so adding a source type does not mean touching the engine.
 */
export async function* readRows(source, sheet) {
  if (source.kind === 'GOOGLE_SHEET') {
    if (!source.googleConnection) {
      throw new Error('This source is not connected to a Google account');
    }
    const headers = Array.isArray(sheet.headers) ? sheet.headers : [];
    yield* streamRows(source.googleConnection, {
      spreadsheetId: source.spreadsheetId,
      sheetTitle: sheet.title,
      headerRow: sheet.headerRow,
      headerCount: headers.length,
    });
    return;
  }

  yield* streamUploadedRows(source.id);
}
