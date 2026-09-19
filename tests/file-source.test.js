import './setup-env.js';
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseUpload, FileImportError } from '../services/file-source.js';

/** File parsing only — staging to the database is covered by the sync tests. */

const csv = (text) => ({ buffer: Buffer.from(text, 'utf8'), filename: 'supplier.csv' });

describe('parseUpload — CSV', () => {
  it('reads headers and rows', async () => {
    const { headers, rows } = await parseUpload(
      csv('Product Name,SKU,Price\nBlue Shirt,SH-01,1299\nRed Shirt,SH-02,1399\n')
    );

    expect(headers).toEqual(['Product Name', 'SKU', 'Price']);
    expect(rows).toHaveLength(2);
    expect(rows[0].cells).toEqual(['Blue Shirt', 'SH-01', '1299']);
    expect(rows[0].rowNumber).toBe(2);
  });

  it('skips blank rows used as separators', async () => {
    const { rows } = await parseUpload(csv('A,B\n1,2\n\n3,4\n'));
    expect(rows).toHaveLength(2);
  });

  it('pads short rows to the header width', async () => {
    const { rows } = await parseUpload(csv('A,B,C\n1,2\n'));
    expect(rows[0].cells).toEqual(['1', '2', '']);
  });

  it('strips a byte-order mark from the first header', async () => {
    const { headers } = await parseUpload(csv('﻿Title,SKU\nShirt,S1\n'));
    expect(headers[0]).toBe('Title');
  });

  it('disambiguates duplicate headers', async () => {
    const { headers } = await parseUpload(csv('Price,Price\n1,2\n'));
    expect(headers).toEqual(['Price', 'Price (2)']);
  });

  it('names an empty header column after its letter', async () => {
    const { headers } = await parseUpload(csv('Title,,SKU\nShirt,x,S1\n'));
    expect(headers[1]).toBe('Column B');
  });

  it('gives each row a stable hash that changes with its content', async () => {
    const first = await parseUpload(csv('A\n1\n'));
    const same = await parseUpload(csv('A\n1\n'));
    const different = await parseUpload(csv('A\n2\n'));

    expect(first.rows[0].hash).toBe(same.rows[0].hash);
    expect(first.rows[0].hash).not.toBe(different.rows[0].hash);
  });

  it('rejects an unsupported extension with a suggestion', async () => {
    await expect(
      parseUpload({ buffer: Buffer.from('x'), filename: 'catalog.pdf' })
    ).rejects.toThrow(FileImportError);
  });

  it('rejects a file over the size limit', async () => {
    const big = Buffer.alloc(21 * 1024 * 1024);
    await expect(parseUpload({ buffer: big, filename: 'big.csv' })).rejects.toThrow(/larger than 20MB/);
  });
});

describe('parseUpload — Excel', () => {
  async function workbookBuffer(rows) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Products');
    for (const row of rows) sheet.addRow(row);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  it('reads an xlsx workbook', async () => {
    const buffer = await workbookBuffer([
      ['Product Name', 'SKU', 'Price'],
      ['Blue Shirt', 'SH-01', 1299],
    ]);

    const { headers, rows, worksheetName } = await parseUpload({ buffer, filename: 'supplier.xlsx' });
    expect(headers).toEqual(['Product Name', 'SKU', 'Price']);
    expect(rows[0].cells).toEqual(['Blue Shirt', 'SH-01', '1299']);
    expect(worksheetName).toBe('Products');
  });

  it('rejects an empty workbook with guidance', async () => {
    const buffer = await workbookBuffer([]);
    await expect(parseUpload({ buffer, filename: 'empty.xlsx' })).rejects.toThrow(FileImportError);
  });
});
