import './setup-env.js';
import { describe, it, expect } from 'vitest';
import { assertFetchableUrl, parseCsvText } from '../services/url-source.js';
import { FileImportError } from '../services/file-source.js';
import { parseSpreadsheetId } from '../lib/google/service-account.js';

/**
 * The published-CSV source makes the server fetch a URL a user supplied, which
 * is the classic SSRF shape. These tests pin the guard, because a gap here
 * would let a crafted link reach cloud metadata endpoints or internal services
 * that the server can see and the merchant cannot.
 */

describe('assertFetchableUrl — rejects private targets', () => {
  it('rejects loopback by name', async () => {
    await expect(assertFetchableUrl('https://localhost/data.csv')).rejects.toThrow(FileImportError);
  });

  it('rejects loopback by address', async () => {
    await expect(assertFetchableUrl('https://127.0.0.1/data.csv')).rejects.toThrow(/private address/i);
  });

  it('rejects the cloud metadata address', async () => {
    // 169.254.169.254 is where AWS, GCP and Azure expose instance credentials.
    await expect(assertFetchableUrl('https://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private address/i
    );
  });

  it('rejects private ranges', async () => {
    for (const host of ['10.0.0.5', '192.168.1.10', '172.16.4.2', '100.64.0.1']) {
      await expect(assertFetchableUrl(`https://${host}/x.csv`)).rejects.toThrow(/private address/i);
    }
  });

  it('rejects IPv6 loopback and unique-local addresses', async () => {
    await expect(assertFetchableUrl('https://[::1]/x.csv')).rejects.toThrow(/private address/i);
    await expect(assertFetchableUrl('https://[fd00::1]/x.csv')).rejects.toThrow(/private address/i);
  });

  it('rejects an IPv4-mapped IPv6 address that hides a private one', async () => {
    await expect(assertFetchableUrl('https://[::ffff:169.254.169.254]/x')).rejects.toThrow(
      /private address/i
    );
  });

  it('rejects .internal hostnames', async () => {
    await expect(assertFetchableUrl('https://metadata.internal/x.csv')).rejects.toThrow(
      /private address/i
    );
  });
});

describe('assertFetchableUrl — rejects unusable links', () => {
  it('requires https', async () => {
    await expect(assertFetchableUrl('http://example.com/x.csv')).rejects.toThrow(/must use https/i);
  });

  it('rejects a non-URL', async () => {
    await expect(assertFetchableUrl('not a url')).rejects.toThrow(/not a valid link/i);
  });

  it('rejects other protocols', async () => {
    await expect(assertFetchableUrl('file:///etc/passwd')).rejects.toThrow(/must use https/i);
  });

  it('accepts a real published Google Sheets link', async () => {
    const url = await assertFetchableUrl(
      'https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pub?output=csv'
    );
    expect(url.hostname).toBe('docs.google.com');
  });
});

describe('parseCsvText', () => {
  it('parses headers and rows', () => {
    const { headers, rows } = parseCsvText('Product Name,SKU,Price\nBlue Shirt,SH-01,1299\n');
    expect(headers).toEqual(['Product Name', 'SKU', 'Price']);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual(['Blue Shirt', 'SH-01', '1299']);
    expect(rows[0].rowNumber).toBe(2);
  });

  it('numbers rows so they line up with the spreadsheet', () => {
    const { rows } = parseCsvText('A\n1\n2\n3\n');
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 4]);
  });

  it('skips blank separator rows', () => {
    const { rows } = parseCsvText('A,B\n1,2\n\n3,4\n');
    expect(rows).toHaveLength(2);
  });

  it('strips a byte-order mark', () => {
    const { headers } = parseCsvText('﻿Title,SKU\nShirt,S1\n');
    expect(headers[0]).toBe('Title');
  });

  it('rejects an empty file', () => {
    expect(() => parseCsvText('')).toThrow(FileImportError);
  });

  it('hashes rows so unchanged ones can be skipped', () => {
    const a = parseCsvText('A\n1\n');
    const b = parseCsvText('A\n1\n');
    const c = parseCsvText('A\n2\n');
    expect(a.rows[0].hash).toBe(b.rows[0].hash);
    expect(a.rows[0].hash).not.toBe(c.rows[0].hash);
  });
});

describe('parseSpreadsheetId', () => {
  it('reads the id out of an edit URL', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEfG_hIjK123456/edit#gid=0')).toBe(
      '1AbC-dEfG_hIjK123456'
    );
  });

  it('reads the id out of a share URL', () => {
    expect(
      parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC-dEfG_hIjK123456/edit?usp=sharing')
    ).toBe('1AbC-dEfG_hIjK123456');
  });

  it('accepts a bare id', () => {
    expect(parseSpreadsheetId('1AbC-dEfG_hIjK123456789')).toBe('1AbC-dEfG_hIjK123456789');
  });

  it('rejects anything else', () => {
    expect(parseSpreadsheetId('https://example.com/not-a-sheet')).toBeNull();
    expect(parseSpreadsheetId('short')).toBeNull();
    expect(parseSpreadsheetId('')).toBeNull();
    expect(parseSpreadsheetId(null)).toBeNull();
  });
});
