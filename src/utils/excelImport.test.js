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

describe('parseFormAnugerahExcel — PBD Tahun labels follow the sheet', () => {
  const pbdSheet = (labels) => {
    const rows = [];
    rows[1] = [null, 'TOLONG ISI DI SINI'];
    rows[2] = [null, 'HARI ANUGERAH KECEMERLANGAN MURID'];
    rows[3] = [null, 'ANUGERAH KECEMERLANGAN PBD'];
    rows[4] = [null, 'TAHUN 1 ADIL'];
    rows[6] = ['TAHUN', 'KUANTITI', null, null, 'TAHUN 1', null, null, null, 'TAHUN 2'];
    rows[7] = [null, null, null, null, 'NAMA KELAS', 'QTY', null, null, 'NAMA KELAS', 'QTY'];
    rows[8] = [labels[0], 12, null, null, 'GAGI', 5, null, null, 'GAGI', 8];
    rows[9] = [labels[1], 11, null, null, 'HAZIQ', 7, null, null, 'HAZIQ', 3];
    rows[10] = [labels[2], 5];
    rows[11] = ['TOTAL', 28];
    rows[13] = [null, 'JENIS PLAK', 'QTY', 'HARGA'];
    rows[14] = [null, 'DECO LIGHT', 28];
    return workbookFromSheets({ PBD: rows.map((r) => r || []) });
  };

  it('keeps a qualifier the teacher added ("TAHUN 1 PKB") as the row label', () => {
    const section = (parseFormAnugerahExcel(pbdSheet(['TAHUN 1 PKB', 'TAHUN 2 PKB', 'TAHUN 3 PKB'])).categorized?.PBD || [])[0];
    expect(section.subjectOrder).toEqual(['TAHUN 1 PKB', 'TAHUN 2 PKB', 'TAHUN 3 PKB']);
    expect(section.tahunRows.map((t) => [t.tahun, t.qty])).toEqual([
      ['TAHUN 1 PKB', 12], // overridden by the GAGI+HAZIQ breakdown sum
      ['TAHUN 2 PKB', 11],
      ['TAHUN 3 PKB', 5],
    ]);
  });

  it('lines a bare "TAHUN 1" breakdown header up with the "TAHUN 1 PKB" row', () => {
    const section = (parseFormAnugerahExcel(pbdSheet(['TAHUN 1 PKB', 'TAHUN 2 PKB', 'TAHUN 3 PKB'])).categorized?.PBD || [])[0];
    expect(section.levelBreakdown.map((lb) => lb.label)).toEqual(['TAHUN 1 PKB', 'TAHUN 2 PKB']);
  });

  it('still works with the plain TAHUN 1-6 labels', () => {
    const section = (parseFormAnugerahExcel(pbdSheet(['TAHUN 1', 'TAHUN 2', 'TAHUN 3'])).categorized?.PBD || [])[0];
    expect(section.subjectOrder).toEqual(['TAHUN 1', 'TAHUN 2', 'TAHUN 3']);
  });
});

describe('parseFormAnugerahExcel — ALIRAN TERBAIK (Kalau ada kelas)', () => {
  it('reads the KEDUDUKAN table AND the per-Tahun Nama Kelas breakdown', () => {
    const r = [];
    r[0] = [null, null, null, null, 'TOLONG ISI DI SINI'];
    r[1] = [null, null, null, null, 'HARI ANUGERAH KECEMERLANGAN 2026'];
    r[2] = [null, null, null, null, 'TERBAIK DALAM ALIRAN'];
    r[3] = [null, null, null, null, 'TAHUN 1'];
    r[4] = [null, null, null, null, 'PERTAMA'];
    r[8] = ['TAHUN', 'KEDUDUKAN', null, 'TOTAL', null, null, 'TAHUN 1', null, null, 'TAHUN 4'];
    r[9] = [null, 'DARI', 'HINGGA KE', null, null, null, 'NAMA KELAS', 'QTY', null, 'NAMA KELAS', 'QTY'];
    r[10] = ['TAHUN 1', null, null, null, null, null, 'ADIL', 1, null, 'ADIL', 1];
    r[11] = ['TAHUN 2', null, null, null, null, null, 'BESTARI', 1, null, 'BESTARI', 1];
    r[12] = ['TAHUN 3', null, null, null, null, null, null, null, null, 'CEKAL', 1];
    r[13] = ['TAHUN 4', 'PERTAMA', 'KELIMA'];
    r[14] = ['TAHUN 5'];
    r[15] = ['TAHUN 6'];
    r[16] = ['TOTAL:'];
    r[19] = [null, 'JENIS PLAK', 'CATATAN', null, 'QTY', 'HARGA'];
    r[20] = [null, null, 'DARI', 'HINGGA KE'];
    r[21] = [null, 'DECO LIGHT', 'PERTAMA', 'KELIMA'];
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ 'ALIRAN TERBAIK Kalau ada kelas': r.map((x) => x || []) }));
    const section = (parsed.categorized?.ALIRAN_KELAS || [])[0];
    expect(section.isAliranKelas).toBe(true);
    expect(section.tahunRows).toEqual([{ tahun: 'TAHUN 4', dari: 1, hingga: 5 }]);
    expect(section.levelBreakdown.map((lb) => [lb.label, lb.mainRows.map((m) => m.name)])).toEqual([
      ['TAHUN 1', ['ADIL', 'BESTARI']],
      ['TAHUN 4', ['ADIL', 'BESTARI', 'CEKAL']],
    ]);
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
