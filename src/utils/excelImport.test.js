import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFormAnugerahExcel } from './excelImport';

function workbookFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, aoa]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

describe('parseFormAnugerahExcel — SELEMPANG sheet', () => {
  it('reads ACARA / WARNA / KUANTITI rows and normalises the colour', () => {
    const buf = workbookFromSheets({
      SELEMPANG: [
        ['ACARA', 'WARNA', 'KUANTITI', null, 'CONTOH WARNA', null],
        ['HARI SUKAN 2026', 'biru', 20, null, 'BIRU', '0053'],
        ['HARI SUKAN 2026', 'MERAH', 10, null, 'HIJAU', '0052'],
        ['HARI KANTIN', '0051', 5, null, 'KUNING', '0051'],
        ['NAK BETUL', 'ungu', 3, null, 'MERAH', '0050'],
      ],
    });
    const parsed = parseFormAnugerahExcel(buf);
    const section = (parsed.categorized?.SELEMPANG || [])[0];
    expect(section).toBeTruthy();
    expect(section.isSelempangList).toBe(true);
    expect(section.selempangRows).toEqual([
      { acara: 'HARI SUKAN 2026', warna: 'BIRU', warnaCode: '0053', qty: 20 },
      { acara: 'HARI SUKAN 2026', warna: 'MERAH', warnaCode: '0050', qty: 10 },
      { acara: 'HARI KANTIN', warna: 'KUNING', warnaCode: '0051', qty: 5 },
      // Unrecognised colour is kept raw (blank code) for the teacher to fix on Step 2.
      { acara: 'NAK BETUL', warna: 'ungu', warnaCode: '', qty: 3 },
    ]);
  });

  it('ignores a blank SELEMPANG template (no rows filled in)', () => {
    const buf = workbookFromSheets({
      SELEMPANG: [
        ['ACARA', 'WARNA', 'KUANTITI'],
        [null, null, null],
        [null, null, null],
      ],
    });
    const parsed = parseFormAnugerahExcel(buf);
    expect(parsed.categorized?.SELEMPANG).toBeUndefined();
  });
});

describe('parseFormAnugerahExcel — two-line TAJUK BESAR', () => {
  it('splits an in-cell line break (Alt+Enter) into slot 0 + slot 0b', () => {
    const buf = workbookFromSheets({
      'MP THP 2': [
        [null, 'HARI ANUGERAH KECEMERLANGAN MURID 2026\nSK CONTOH'],
        [null, 'TERBAIK MATA PELAJARAN'],
        [null, 'BAHASA MELAYU'],
        [null, 'TAHUN 1'],
        ['SUBJEK', 'KUANTITI'],
        [null, 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
        ['BAHASA MELAYU', 5, 5, 5],
        ['TOTAL', 5, 5, 5],
        [null, 'JENIS PLAK', 'QTY', 'HARGA'],
        [null, 'DECO LIGHT', 15],
      ],
    });
    const section = (parseFormAnugerahExcel(buf).categorized?.MP2 || [])[0];
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID 2026');
    expect(section.lines['0b']).toBe('SK CONTOH');
  });

  it('leaves a single-line TAJUK BESAR untouched (no slot 0b)', () => {
    const buf = workbookFromSheets({
      'MP THP 2': [
        [null, 'HARI ANUGERAH KECEMERLANGAN MURID 2026'],
        [null, 'TERBAIK MATA PELAJARAN'],
        [null, 'BAHASA MELAYU'],
        [null, 'TAHUN 1'],
        ['SUBJEK', 'KUANTITI'],
        [null, 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
        ['BAHASA MELAYU', 5, 5, 5],
        ['TOTAL', 5, 5, 5],
        [null, 'JENIS PLAK', 'QTY', 'HARGA'],
        [null, 'DECO LIGHT', 15],
      ],
    });
    const section = (parseFormAnugerahExcel(buf).categorized?.MP2 || [])[0];
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID 2026');
    expect(section.lines['0b']).toBeUndefined();
  });
});
