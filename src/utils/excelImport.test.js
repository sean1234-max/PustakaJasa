import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFormAnugerahExcel, matchJenisPlakPath } from './excelImport';
import { computeBlocks, noopUpdaters } from './computeBlocks';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { buildCsvRows } from './exportCsv';
import { checkAliranKelasTotals } from './importChecks';

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
    expect(section.tahunRows).toEqual([{ tahun: 'TAHUN 4', dari: 1, hingga: 5, statedTotal: null }]);
    expect(section.levelBreakdown.map((lb) => [lb.label, lb.mainRows.map((m) => m.name)])).toEqual([
      ['TAHUN 1', ['ADIL', 'BESTARI']],
      ['TAHUN 4', ['ADIL', 'BESTARI', 'CEKAL']],
    ]);
  });

  it('reads the typed TOTAL and flags it only when it disagrees with the breakdown', () => {
    const base = [];
    base[0] = [null, null, null, null, 'TOLONG ISI DI SINI'];
    base[1] = [null, null, null, null, 'HARI ANUGERAH 2026'];
    base[2] = [null, null, null, null, 'TERBAIK DALAM ALIRAN'];
    base[3] = [null, null, null, null, 'TAHUN 4'];
    base[8] = ['TAHUN', 'KEDUDUKAN', null, 'TOTAL', null, null, 'TAHUN 4', null, null, 'TAHUN 5'];
    base[9] = [null, 'DARI', 'HINGGA KE', null, null, null, 'NAMA KELAS', 'QTY', null, 'NAMA KELAS', 'QTY'];
    // TAHUN 4 ranked PERTAMA–KELIMA (5), 3 Nama Kelas × 1 → derived 15.
    base[10] = ['TAHUN 4', 'PERTAMA', 'KELIMA', null, null, null, 'ADIL', 1, null, 'ADIL', 1];
    base[11] = ['TAHUN 5', null, null, null, null, null, 'BESTARI', 1, null, 'BESTARI', 1];
    base[12] = ['TAHUN 6', null, null, null, null, null, 'CEKAL', 1];
    base[13] = ['TOTAL:'];
    const parseWithTotal = (total) => {
      const r = base.map((x) => (x ? [...x] : []));
      r[10][3] = total; // the TOTAL column (right of HINGGA KE)
      return (parseFormAnugerahExcel(workbookFromSheets({ 'ALIRAN TERBAIK Kalau ada kelas': r })).categorized?.ALIRAN_KELAS || [])[0];
    };
    expect(parseWithTotal(15).tahunRows[0].statedTotal).toBe(15);
    expect(checkAliranKelasTotals(parseWithTotal(15))).toEqual([]);
    expect(checkAliranKelasTotals(parseWithTotal(9))).toEqual([
      { id: 'aliranktot:TAHUN 4', level: 'TAHUN 4', stated: 9, computed: 15, classSum: 3, classCount: 3, rangeSize: 5 },
    ]);
  });
});

describe('ALIRAN TERBAIK (Kalau ada kelas) — import → auto TOTAL → cart → CSV', () => {
  // The "TAHUN 1" breakdown block (col G) lists ADIL/BESTARI/CEKAL — 3
  // classes for the flat TAHUN 1 → TOTAL 3. The "TAHUN 4" block (col J)
  // lists ADIL/BESTARI/CEKAL/DINAMIK — 4 classes, and TAHUN 4 is ranked
  // PERTAMA–KELIMA (5) → TOTAL 4 × 5 = 20. Grand total 23.
  const r = [];
  r[0] = [null, null, null, null, 'TOLONG ISI DI SINI'];
  r[1] = [null, null, null, null, 'SEKOLAH KEBANGSAAN CONTOH\nHARI ANUGERAH 2026'];
  r[3] = [null, null, null, null, 'TERBAIK DALAM ALIRAN'];
  r[5] = [null, null, null, null, 'TAHUN 1'];
  r[6] = [null, null, null, null, 'PERTAMA'];
  r[8] = ['TAHUN', 'KEDUDUKAN', null, 'TOTAL', null, null, 'TAHUN 1', null, null, 'TAHUN 4'];
  r[9] = [null, 'DARI', 'HINGGA KE', null, null, null, 'NAMA KELAS', 'QTY', null, 'NAMA KELAS', 'QTY'];
  r[10] = ['TAHUN 1', null, null, null, null, null, 'ADIL', 1, null, 'ADIL', 1];
  r[11] = ['TAHUN 2', null, null, null, null, null, 'BESTARI', 1, null, 'BESTARI', 1];
  r[12] = ['TAHUN 3', null, null, null, null, null, 'CEKAL', 1, null, 'CEKAL', 1];
  r[13] = ['TAHUN 4', 'PERTAMA', 'KELIMA', null, null, null, null, null, null, 'DINAMIK', 1];
  r[14] = ['TAHUN 5'];
  r[15] = ['TAHUN 6'];
  r[16] = ['TOTAL:'];
  r[19] = [null, 'JENIS PLAK', 'CATATAN', null, 'QTY', 'HARGA'];
  r[20] = [null, null, 'DARI', 'HINGGA KE'];
  r[21] = [null, 'DECO LIGHT', 'PERTAMA', 'KELIMA'];
  r[22] = [null, 'H25 FLAT'];

  const catalog = [
    { code: 'DECO LIGHT', price: 5, stockQty: 1e6, stockBaseline: 1e6 },
    { code: 'H25 FLAT', price: 4, stockQty: 1e6, stockBaseline: 1e6 },
  ];

  // Minimal replica of AppState.importFormAnugerahExcel's isAliranKelas branch.
  const buildDraft = (section) => {
    const key = 'ALIRAN_KELAS::0';
    let id = 1;
    const rowsByBlock = {};
    const byTahun = new Map(section.tahunRows.map((tr) => [tr.tahun, tr]));
    rowsByBlock[key] = ['TAHUN 1', 'TAHUN 2', 'TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'].map((t) => {
      const tr = byTahun.get(t);
      if (tr && tr.hingga) return { id: id++, desc: t, qty: String(tr.hingga - (tr.dari || 1) + 1), kedudukanHingga: tr.hingga };
      return { id: id++, desc: t, qty: '', kedudukanHingga: 0 };
    });
    (section.levelBreakdown || []).forEach(({ label, mainRows }) => {
      rowsByBlock[`${key}::${label}::main`] = mainRows.map((m) => ({ id: id++, desc: m.name, qty: String(m.qty) }));
    });
    const ranged = new Set(section.tahunRows.filter((tr) => tr.hingga).map((tr) => tr.tahun));
    const plak = section.plakRanges.map((pr) => ({
      id: id++, jenisPlak: matchJenisPlakPath(pr.jenisPlak, catalog) || pr.jenisPlak,
      posDari: pr.dari || null, posHingga: pr.hingga || null, qty: null,
    }));
    if (section.levelBreakdown.some((lb) => !ranged.has(lb.label)) && !plak.some((p) => !p.posDari)) {
      plak.push({ id: id++, jenisPlak: '', posDari: null, posHingga: null, qty: null });
    }
    const lineValues = {};
    Object.entries(section.lines).forEach(([s, v]) => { lineValues[`${key}::${s}`] = v; });
    return { lineValues, matrixValues: {}, rowsByBlock, plakRows: { [key]: plak }, columnsByBlock: {}, plakCatalog: catalog, schoolLanguage: 'SK' };
  };

  it('each Tahun TOTAL = classes × KEDUDUKAN range; cart + CSV line up', () => {
    const section = (parseFormAnugerahExcel(workbookFromSheets({ 'ALIRAN TERBAIK Kalau ada kelas': r.map((x) => x || []) })).categorized?.ALIRAN_KELAS || [])[0];
    expect(section.isAliranKelas).toBe(true);

    const st = buildDraft(section);
    const blk = computeBlocks('ALIRAN_KELAS', st.lineValues, {}, st.rowsByBlock, st.plakRows, {}, noopUpdaters, catalog, 'SK').blocks[0];
    expect(blk.rows.map((x) => Number(x.qty) || 0)).toEqual([3, 0, 0, 20, 0, 0]);
    expect(blk.rows[0].qtyReadOnly && blk.rows[3].qtyReadOnly).toBe(true);
    expect(blk.blockTotalQty).toBe(23);

    const res = buildCategoryCartItems(st, 'ALIRAN_KELAS');
    expect(res.error).toBeUndefined();
    expect(res.items.map((i) => i.qty).reduce((a, b) => a + b, 0)).toBe(23);

    const { rows, skippedItemIds } = buildCsvRows({ schoolLanguage: 'SK', items: res.items }, 'ALIRAN_KELAS', res.items);
    expect(skippedItemIds).toEqual([]);
    expect(rows).toHaveLength(23);
    // event_header two-line, year retired, event_line_1 = ACARA for all.
    expect(rows.every((x) => x[0] === 'SEKOLAH KEBANGSAAN CONTOH\nHARI ANUGERAH 2026' && x[1] === '' && x[3] === 'TERBAIK DALAM ALIRAN')).toBe(true);
    // TAHUN 4 DINAMIK: 5 plaques, positions PERTAMA..KELIMA.
    expect(rows.filter((x) => x[4] === 'TAHUN 4 DINAMIK')).toHaveLength(5);
    expect(new Set(rows.filter((x) => x[4] === 'TAHUN 4 DINAMIK').map((x) => x[2])))
      .toEqual(new Set(['PERTAMA', 'KEDUA', 'KETIGA', 'KEEMPAT', 'KELIMA']));
    // Flat Tahuns: blank position, "TAHUN N <class>" in event_line_2.
    expect(rows.filter((x) => x[2] === '' && x[4] === 'TAHUN 1 ADIL')).toHaveLength(1);
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

  // A real sample (SK HULU BERNAM.xlsx) had the "kalau tajuk besar 2 baris,
  // pakai ALT+ENTER" instruction note sitting a few columns to the right of
  // the title, ON THE SAME ROW as the title's own second line — the
  // reference-sample reader used to scan that whole row width and glued the
  // note onto slot 0b (e.g. "SK HULU BERNAM JIKA TAJUK BESAR MEMPUNYAI DUA
  // BARIS: Untuk baris kedua, sila tekan butang ALT + ENTER..."). Every
  // sheet whose title-band read isn't already narrowed to one column
  // (parseSubjectLevelSheet — MP THP/PPKI, parsePbdSheet, TOKOH) must ignore
  // a note cell placed off to the side like this.
  const altEnterNote = 'JIKA TAJUK BESAR MEMPUNYAI DUA BARIS:\nUntuk baris kedua, sila tekan butang ALT + ENTER pada masa yang sama';

  it('ignores the ALT+ENTER instruction note next to the title (MP THP)', () => {
    const buf = workbookFromSheets({
      'MP THP 2': [
        [null, 'TOLONG ISI DI SINI'],
        [null, 'HARI ANUGERAH KECEMERLANGAN MURID 2026\nSK CONTOH', null, null, null, altEnterNote],
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

  it('ignores the ALT+ENTER instruction note next to the title (PBD)', () => {
    const rows = [];
    rows[1] = [null, 'TOLONG ISI DI SINI'];
    rows[2] = [null, 'HARI ANUGERAH KECEMERLANGAN MURID\nSK CONTOH', null, null, null, altEnterNote];
    rows[3] = [null, 'ANUGERAH KECEMERLANGAN PBD'];
    rows[6] = ['TAHUN', 'KUANTITI', null, null, 'TAHUN 1'];
    rows[7] = [null, null, null, null, 'NAMA KELAS', 'QTY'];
    rows[8] = ['TAHUN 1', 12, null, null, 'GAGI', 12];
    rows[9] = ['TOTAL', 12];
    rows[11] = [null, 'JENIS PLAK', 'QTY', 'HARGA'];
    rows[12] = [null, 'DECO LIGHT', 12];
    const buf = workbookFromSheets({ PBD: rows.map((r) => r || []) });
    const section = (parseFormAnugerahExcel(buf).categorized?.PBD || [])[0];
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID');
    expect(section.lines['0b']).toBe('SK CONTOH');
  });

  it('ignores the ALT+ENTER instruction note next to the title (TOKOH)', () => {
    const buf = workbookFromSheets({
      TOKOH: [
        [null, null, null, 'TOLONG ISI DI SINI'],
        [null, null, null, 'HARI ANUGERAH KECEMERLANGAN MURID\nSK CONTOH', null, null, null, altEnterNote],
        [null, null, null, 'TOKOH MURID'],
        [],
        [],
        ['TOKOH', 'NAMA MURID', 'GAMBAR (YES/NO)', 'KUANTITI', 'JENIS PLAK'],
        ['TOKOH MURID', 'Ali', 'YES', 1, 'DECO LIGHT'],
      ],
    });
    const section = (parseFormAnugerahExcel(buf).categorized?.TOKOH_SHEET || [])[0];
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID');
    expect(section.lines['0b']).toBe('SK CONTOH');
  });
});
