import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFormAnugerahExcel, matchJenisPlakPath } from './excelImport';
import { computeBlocks, noopUpdaters } from './computeBlocks';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { buildCsvRows } from './exportCsv';
import { checkAliranKelasTotals } from './importChecks';
import { makeDynamicCategoryKey, resolveCategory } from '../data/catalog';

function workbookFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, aoa]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

describe('matchJenisPlakPath', () => {
  it('matches a root-level code directly, walking down to the mentioned finish', () => {
    const tree = [
      { code: 'SM-13187', children: [{ code: 'GOLD', children: [{ code: 'NORMAL' }, { code: 'BASE A' }] }] },
    ];
    expect(matchJenisPlakPath('SM - 13187 (GOLD)', tree)).toBe('SM-13187 / GOLD / NORMAL');
  });

  it('falls back one level when the real product code sits under an umbrella group node the teacher never types', () => {
    // Mirrors the live catalog: "CRYSTAL" groups "00S" / "R-100", each with
    // its own DESIGN A/B/C children — a teacher only ever writes "00S" or
    // "R-100", never "CRYSTAL", so the root-level scan alone finds nothing.
    const tree = [
      {
        code: 'CRYSTAL',
        children: [
          { code: '00S', children: [{ code: 'DESIGN A' }, { code: 'DESIGN C' }] },
          { code: 'R-100', children: [{ code: 'DESIGN A' }, { code: 'DESIGN C' }] },
        ],
      },
    ];
    expect(matchJenisPlakPath('00S (DESIGN C)', tree)).toBe('CRYSTAL / 00S / DESIGN C');
    expect(matchJenisPlakPath('R-100 (Design C)', tree)).toBe('CRYSTAL / R-100 / DESIGN C');
    expect(matchJenisPlakPath('R-100/DESIGN C', tree)).toBe('CRYSTAL / R-100 / DESIGN C');
  });

  it('returns empty when even the fallback level has no matching code', () => {
    const tree = [{ code: 'CRYSTAL', children: [{ code: '00S', children: [{ code: 'DESIGN A' }] }] }];
    expect(matchJenisPlakPath('PKC 266', tree)).toBe('');
  });
});

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

describe('parseFormAnugerahExcel — "PPKI,PRA" sheet name (the real official template\'s actual PPKI tab)', () => {
  const ppkiRows = [
    ['SUBJEK', 'KUANTITI'],
    [null, 'PRA PPKI', 'PPKI', 'PRASEKOLAH'],
    ['BAHASA MELAYU', 14, 6, 16],
    ['TOTAL', 14, 6, 16],
  ];

  it('is recognized as PPKI, not left unrecognized', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ 'PPKI,PRA': ppkiRows }));
    expect(parsed.unrecognizedSheets).toEqual([]);
    const section = (parsed.categorized?.PPKI || [])[0];
    expect(section).toBeDefined();
    expect(section.subjectOrder).toEqual(['BAHASA MELAYU']);
  });

  it('an exact "PPKI" sheet still works too (the alias is additive, not a replacement)', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ PPKI: ppkiRows }));
    expect((parsed.categorized?.PPKI || [])[0]).toBeDefined();
  });

  it('"PPKI,PRA" is not double-counted as an ALSO-unrecognized leftover sheet', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'PPKI,PRA': ppkiRows,
      'ALIRAN TERBAIK': [['TAHUN', 'KEDUDUKAN'], [null, 'DARI', 'HINGGA KE'], ['TAHUN 1', 'PERTAMA', 'KETIGA']],
    }));
    expect(parsed.categorized?.PPKI).toHaveLength(1);
    expect(parsed.unrecognizedSheets).toEqual([]);
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
    // TAHUN 4 ranked PERTAMA–KELIMA (5, irrelevant to the total — each
    // class's own QTY already IS the total), 3 Nama Kelas × 1 -> total 3.
    base[10] = ['TAHUN 4', 'PERTAMA', 'KELIMA', null, null, null, 'ADIL', 1, null, 'ADIL', 1];
    base[11] = ['TAHUN 5', null, null, null, null, null, 'BESTARI', 1, null, 'BESTARI', 1];
    base[12] = ['TAHUN 6', null, null, null, null, null, 'CEKAL', 1];
    base[13] = ['TOTAL:'];
    const parseWithTotal = (total) => {
      const r = base.map((x) => (x ? [...x] : []));
      r[10][3] = total; // the TOTAL column (right of HINGGA KE)
      return (parseFormAnugerahExcel(workbookFromSheets({ 'ALIRAN TERBAIK Kalau ada kelas': r })).categorized?.ALIRAN_KELAS || [])[0];
    };
    expect(parseWithTotal(3).tahunRows[0].statedTotal).toBe(3);
    expect(checkAliranKelasTotals(parseWithTotal(3))).toEqual([]);
    expect(checkAliranKelasTotals(parseWithTotal(9))).toEqual([
      { id: 'aliranktot:TAHUN 4', level: 'TAHUN 4', stated: 9, computed: 3, classSum: 3, classCount: 3 },
    ]);
  });
});

describe('ALIRAN TERBAIK (Kalau ada kelas) — import → auto TOTAL → cart → CSV', () => {
  // The "TAHUN 1" breakdown block (col G) lists ADIL/BESTARI/CEKAL — 3
  // classes for the flat TAHUN 1 → TOTAL 3. The "TAHUN 4" block (col J)
  // lists ADIL/BESTARI/CEKAL/DINAMIK — 4 classes → TOTAL 4 (each class's
  // own QTY is its total directly — NOT multiplied by the KEDUDUKAN range,
  // even though TAHUN 4 is ranked PERTAMA–KELIMA). Grand total 7.
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

  it('each Tahun TOTAL = its own Nama Kelas sum (not multiplied by KEDUDUKAN range); cart + CSV line up', () => {
    const section = (parseFormAnugerahExcel(workbookFromSheets({ 'ALIRAN TERBAIK Kalau ada kelas': r.map((x) => x || []) })).categorized?.ALIRAN_KELAS || [])[0];
    expect(section.isAliranKelas).toBe(true);

    const st = buildDraft(section);
    const blk = computeBlocks('ALIRAN_KELAS', st.lineValues, {}, st.rowsByBlock, st.plakRows, {}, noopUpdaters, catalog, 'SK').blocks[0];
    expect(blk.rows.map((x) => Number(x.qty) || 0)).toEqual([3, 0, 0, 4, 0, 0]);
    expect(blk.rows[0].qtyReadOnly && blk.rows[3].qtyReadOnly).toBe(true);
    expect(blk.blockTotalQty).toBe(7);

    const res = buildCategoryCartItems(st, 'ALIRAN_KELAS');
    expect(res.error).toBeUndefined();
    expect(res.items.map((i) => i.qty).reduce((a, b) => a + b, 0)).toBe(7);

    const { rows, skippedItemIds } = buildCsvRows({ schoolLanguage: 'SK', items: res.items }, 'ALIRAN_KELAS', res.items);
    expect(skippedItemIds).toEqual([]);
    expect(rows).toHaveLength(7);
    // event_header two-line, year retired, event_line_1 = ACARA for all.
    expect(rows.every((x) => x[0] === 'SEKOLAH KEBANGSAAN CONTOH\nHARI ANUGERAH 2026' && x[1] === '' && x[3] === 'TERBAIK DALAM ALIRAN')).toBe(true);
    // TAHUN 4 DINAMIK: qty 1, one plaque — its single position falls at
    // the start of the range (distributeQtyOverPositions' remainder rule).
    expect(rows.filter((x) => x[4] === 'TAHUN 4 DINAMIK')).toHaveLength(1);
    expect(new Set(rows.filter((x) => x[4] === 'TAHUN 4 DINAMIK').map((x) => x[2])))
      .toEqual(new Set(['PERTAMA']));
    // The Jenis Plak footer covers the Tahun's whole range (DECO LIGHT:
    // PERTAMA-KELIMA), so its own combined qty still equals the Tahun's
    // full total (ADIL+BESTARI+CEKAL+DINAMIK = 4), just distributed across
    // fewer distinct positions than the old (wrong) ×range-size behaviour.
    expect(rows.filter((x) => x[4]?.startsWith('TAHUN 4 '))).toHaveLength(4);
    // Flat Tahuns: blank position, "TAHUN N <class>" in event_line_2.
    expect(rows.filter((x) => x[2] === '' && x[4] === 'TAHUN 1 ADIL')).toHaveLength(1);
  });
});

describe('parseFormAnugerahExcel — renamed/duplicated template sheet becomes its own category', () => {
  // A plain ALIRAN-shaped sheet (TAHUN + KEDUDUKAN + DARI/HINGGA KE + a
  // JENIS PLAK footer), no Nama Kelas breakdown — same shape parseAliranSheet
  // (not the Kelas variant) recognizes.
  const plainAliranRows = () => {
    const r = [];
    r[0] = [null, null, null, null, 'TOLONG ISI DI SINI'];
    r[1] = [null, null, null, null, 'HARI ANUGERAH 2026'];
    r[2] = [null, null, null, null, 'TERBAIK DALAM ALIRAN'];
    r[8] = ['TAHUN', 'KEDUDUKAN'];
    r[9] = [null, 'DARI', 'HINGGA KE'];
    r[10] = ['TAHUN 1', 'PERTAMA', 'KETIGA'];
    r[11] = ['TAHUN 2'];
    r[12] = ['TAHUN 3'];
    r[13] = ['TAHUN 4'];
    r[14] = ['TAHUN 5'];
    r[15] = ['TAHUN 6'];
    r[16] = ['TOTAL:'];
    r[19] = [null, 'JENIS PLAK', 'CATATAN', null, 'QTY', 'HARGA'];
    r[20] = [null, null, 'DARI', 'HINGGA KE'];
    r[21] = [null, 'DECO LIGHT', 'PERTAMA', 'KETIGA'];
    return r.map((x) => x || []);
  };

  it('a sheet named after the teacher\'s own event (not "ALIRAN TERBAIK") is still recognized by shape, under its own dynamic key', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ PENCAPAIAN: plainAliranRows() }));
    const key = makeDynamicCategoryKey('ALIRAN', 'PENCAPAIAN');
    expect(parsed.categorized?.ALIRAN).toBeUndefined();
    const section = (parsed.categorized?.[key] || [])[0];
    expect(section).toBeDefined();
    // parseAliranKelasSheet (the detector used, since it's a strict superset
    // of parseAliranSheet) always tags isAliranKelas:true even with no real
    // breakdown — the *category* still correctly resolves to plain ALIRAN
    // below, since that's decided by levelBreakdown actually having content.
    expect(section.levelBreakdown).toBeNull();
    expect(section.tahunRows[0]).toEqual({ tahun: 'TAHUN 1', dari: 1, hingga: 3, statedTotal: null });
    const cat = resolveCategory(key);
    expect(cat.label).toBe('PENCAPAIAN');
    expect(cat.aliranKedudukan).toBe(true);
    expect(cat.key.startsWith(makeDynamicCategoryKey('ALIRAN', ''))).toBe(true);
  });

  it('a renamed sheet WITH a real Nama Kelas breakdown resolves as the ALIRAN_KELAS template kind', () => {
    // Same shape as the "ALIRAN TERBAIK (Kalau ada kelas)" fixture above
    // (two per-Tahun Nama Kelas blocks), just under an arbitrary sheet name.
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
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ 'SUKAN 2026': r.map((x) => x || []) }));
    const key = makeDynamicCategoryKey('ALIRAN_KELAS', 'SUKAN 2026');
    const section = (parsed.categorized?.[key] || [])[0];
    expect(section).toBeDefined();
    expect(section.isAliranKelas).toBe(true);
    expect(section.levelBreakdown.map((lb) => lb.label)).toEqual(['TAHUN 1', 'TAHUN 4']);
  });

  it('a real "ALIRAN TERBAIK" sheet AND a renamed duplicate coexist as two separate categories, not a collision', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'ALIRAN TERBAIK': plainAliranRows(),
      'HARI KOKURIKULUM': plainAliranRows(),
    }));
    const dynKey = makeDynamicCategoryKey('ALIRAN', 'HARI KOKURIKULUM');
    expect(parsed.categorized?.ALIRAN).toHaveLength(1);
    expect(parsed.categorized?.[dynKey]).toHaveLength(1);
  });

  it('a leftover sheet with real content matching no recognized shape is reported, not silently dropped', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'RANDOM NOTES': [['Just some notes the teacher left here', 'not a real order sheet']],
    }));
    expect(parsed.unrecognizedSheets).toEqual(['RANDOM NOTES']);
  });

  it('an untouched, still-blank sheet is skipped silently — no warning', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'ALIRAN TERBAIK': plainAliranRows(),
      'BLANK SHEET': [[]],
    }));
    expect(parsed.unrecognizedSheets).toEqual([]);
  });

  it('a renamed TOKOH-shaped sheet is recognized under its own dynamic key', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'ANUGERAH KHAS': [
        [null, null, null, 'TOLONG ISI DI SINI'],
        [null, null, null, 'HARI ANUGERAH KECEMERLANGAN MURID'],
        [null, null, null, 'TOKOH MURID'],
        [],
        [],
        ['TOKOH', 'NAMA MURID', 'GAMBAR (YES/NO)', 'KUANTITI', 'JENIS PLAK'],
        ['TOKOH MURID', 'Ali', 'YES', 1, 'DECO LIGHT'],
      ],
    }));
    const key = makeDynamicCategoryKey('TOKOH_SHEET', 'ANUGERAH KHAS');
    const section = (parsed.categorized?.[key] || [])[0];
    expect(section).toBeDefined();
    expect(section.isTokohList).toBe(true);
    expect(resolveCategory(key).label).toBe('ANUGERAH KHAS');
  });

  it('a renamed SELEMPANG-shaped sheet is recognized under its own dynamic key', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'SELEMPANG SUKAN': [
        ['ACARA', 'WARNA', 'KUANTITI'],
        ['HARI SUKAN', 'BIRU', 30],
      ],
    }));
    const key = makeDynamicCategoryKey('SELEMPANG', 'SELEMPANG SUKAN');
    const section = (parsed.categorized?.[key] || [])[0];
    expect(section).toBeDefined();
    expect(section.isSelempangList).toBe(true);
    expect(resolveCategory(key).noCsv).toBe(true);
  });

  it('a renamed PBD-shaped sheet WITH a real Nama Kelas breakdown resolves as PBD', () => {
    // Same shape as the "PBD Tahun labels follow the sheet" fixture above
    // (findPpkiNamaKelasBlocks needs 2+ side-by-side blocks to line up
    // column boundaries), just under an arbitrary sheet name.
    const rows = [];
    rows[1] = [null, 'TOLONG ISI DI SINI'];
    rows[2] = [null, 'HARI ANUGERAH KECEMERLANGAN MURID'];
    rows[3] = [null, 'ANUGERAH KECEMERLANGAN PBD'];
    rows[6] = ['TAHUN', 'KUANTITI', null, null, 'TAHUN 1', null, null, null, 'TAHUN 2'];
    rows[7] = [null, null, null, null, 'NAMA KELAS', 'QTY', null, null, 'NAMA KELAS', 'QTY'];
    rows[8] = ['TAHUN 1', 12, null, null, 'GAGI', 5, null, null, 'GAGI', 8];
    rows[9] = ['TAHUN 2', 11, null, null, 'HAZIQ', 7, null, null, 'HAZIQ', 3];
    rows[10] = ['TAHUN 3', 5];
    rows[11] = ['TOTAL', 28];
    rows[13] = [null, 'JENIS PLAK', 'QTY', 'HARGA'];
    rows[14] = [null, 'DECO LIGHT', 28];
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ 'PENCAPAIAN PBD': rows.map((r) => r || []) }));
    const pbdKey = makeDynamicCategoryKey('PBD', 'PENCAPAIAN PBD');
    const lonjakanKey = makeDynamicCategoryKey('LONJAKAN', 'PENCAPAIAN PBD');
    expect(parsed.categorized?.[lonjakanKey]).toBeUndefined();
    const section = (parsed.categorized?.[pbdKey] || [])[0];
    expect(section).toBeDefined();
    expect(section.isTahunList).toBe(true);
    expect(section.levelBreakdown.map((lb) => lb.label)).toEqual(['TAHUN 1', 'TAHUN 2']);
    expect(resolveCategory(pbdKey).levelBreakdownAxis).toBe('subject');
  });

  it('a renamed TAHUN+KUANTITI sheet with NO Nama Kelas breakdown resolves as LONJAKAN, not PBD', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'PENCAPAIAN SUKAN': [
        ['TAHUN', 'KUANTITI', 'JENIS PLAK'],
        ['TAHUN 1', 5, 'DECO LIGHT'],
        ['TAHUN 2', 3, 'H25'],
      ],
    }));
    const pbdKey = makeDynamicCategoryKey('PBD', 'PENCAPAIAN SUKAN');
    const lonjakanKey = makeDynamicCategoryKey('LONJAKAN', 'PENCAPAIAN SUKAN');
    expect(parsed.categorized?.[pbdKey]).toBeUndefined();
    const section = (parsed.categorized?.[lonjakanKey] || [])[0];
    expect(section).toBeDefined();
    expect(section.isSimpleTahunList).toBe(true);
    expect(section.tahunRows).toEqual([
      { tahun: 'TAHUN 1', label: 'TAHUN 1', qty: 5, jenisPlak: 'DECO LIGHT' },
      { tahun: 'TAHUN 2', label: 'TAHUN 2', qty: 3, jenisPlak: 'H25' },
    ]);
    // Clones LONJAKAN's per-row Jenis Plak behaviour, not PBD's matrix one.
    expect(resolveCategory(lonjakanKey).plakPerRow).toBe(true);
    expect(resolveCategory(lonjakanKey).positionFromRows).toBe(true);
  });

  it('a LONJAKAN-shaped sheet with an extra custom-labelled row (not TAHUN n) keeps that exact wording', () => {
    // A teacher adding rows below the fixed TAHUN 1-6 list with her own
    // label ("TAHAP 1"/"TAHAP 2") means that wording to show on the
    // plaque — not to get folded into the TAHUN slot matching a stray
    // digit in the label, and not to be silently dropped either.
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'LONJAKAN SAUJANA': [
        ['TAHUN', 'KUANTITI', 'JENIS PLAK'],
        ['TAHUN 1', null, null],
        ['TAHUN 2', null, null],
        ['TAHAP 1', 10, 'PKC 266'],
        ['TAHAP 2', 10, 'PKC 266'],
      ],
    }));
    const section = (parsed.categorized?.LONJAKAN || [])[0];
    expect(section.isSimpleTahunList).toBe(true);
    expect(section.tahunRows).toEqual([
      { tahun: '', label: 'TAHAP 1', qty: 10, jenisPlak: 'PKC 266' },
      { tahun: '', label: 'TAHAP 2', qty: 10, jenisPlak: 'PKC 266' },
    ]);
  });

  it('a custom row whose label merely starts with TAHUN ("TAHUN 2026") keeps its exact text instead of landing on TAHUN 2', () => {
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      'SAHSIAH TERPUJI': [
        ['TAHUN', 'KUANTITI', 'JENIS PLAK'],
        ['TAHUN 1', null, null],
        ['TAHUN 2', null, null],
        ['TAHUN 2026', 12, 'PKF 266'],
        ['tahun 3', 5, 'PKF 266'],
      ],
    }));
    const section = (parsed.categorized?.[makeDynamicCategoryKey('LONJAKAN', 'SAHSIAH TERPUJI')] || [])[0];
    expect(section.tahunRows).toEqual([
      { tahun: '', label: 'TAHUN 2026', qty: 12, jenisPlak: 'PKF 266' },
      { tahun: 'TAHUN 3', label: 'tahun 3', qty: 5, jenisPlak: 'PKF 266' },
    ]);
  });

  it('a real "PBD" sheet AND a renamed duplicate (no breakdown) coexist as two separate categories', () => {
    // No Nama Kelas breakdown here, so the renamed copy resolves as
    // LONJAKAN-kind (per the disambiguation rule above) — the point of
    // this test is just that the two don't collide into one, not which
    // template kind the renamed one lands under.
    const pbdRows = [
      ['TAHUN', 'KUANTITI'],
      ['TAHUN 1', 5],
    ];
    const parsed = parseFormAnugerahExcel(workbookFromSheets({
      PBD: pbdRows,
      'PENCAPAIAN AKADEMIK': pbdRows,
    }));
    const dynKey = makeDynamicCategoryKey('LONJAKAN', 'PENCAPAIAN AKADEMIK');
    expect(parsed.categorized?.PBD).toHaveLength(1);
    expect(parsed.categorized?.[dynKey]).toHaveLength(1);
  });

  it('a real "PBD" sheet WITH a breakdown AND a renamed duplicate WITH a breakdown both resolve as PBD, uncollided', () => {
    const rows = [];
    rows[1] = [null, 'TOLONG ISI DI SINI'];
    rows[6] = ['TAHUN', 'KUANTITI', null, null, 'TAHUN 1', null, null, null, 'TAHUN 2'];
    rows[7] = [null, null, null, null, 'NAMA KELAS', 'QTY', null, null, 'NAMA KELAS', 'QTY'];
    rows[8] = ['TAHUN 1', 12, null, null, 'GAGI', 5, null, null, 'GAGI', 8];
    rows[9] = ['TAHUN 2', 11, null, null, 'HAZIQ', 7, null, null, 'HAZIQ', 3];
    const aoa = rows.map((r) => r || []);
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ PBD: aoa, 'PENCAPAIAN PBD 2': aoa }));
    const dynKey = makeDynamicCategoryKey('PBD', 'PENCAPAIAN PBD 2');
    expect(parsed.categorized?.PBD).toHaveLength(1);
    expect(parsed.categorized?.[dynKey]).toHaveLength(1);
  });

  it('a renamed SUBJEK-shaped sheet (PPKI/MP-THP family) resolves as its own dynamicMatrix category', () => {
    const rows = [];
    rows[0] = [null, null, 'TOLONG ISI DI SINI'];
    rows[1] = [null, null, 'HARI ANUGERAH 2026'];
    rows[2] = [null, null, 'PENCAPAIAN AKADEMIK TERBAIK'];
    rows[5] = ['SUBJEK'];
    rows[6] = [null, 'TAHUN 1', 'TAHUN 2'];
    rows[7] = ['BAHASA MELAYU', 5, 3];
    rows[8] = ['MATEMATIK', 2, 4];
    rows[9] = ['TOTAL', 7, 7];
    const parsed = parseFormAnugerahExcel(workbookFromSheets({ 'PENCAPAIAN AKADEMIK': rows.map((r) => r || []) }));
    const dynKey = makeDynamicCategoryKey('KLAS_MATRIX', 'PENCAPAIAN AKADEMIK');
    expect(parsed.unrecognizedSheets).toEqual([]);
    const section = (parsed.categorized?.[dynKey] || [])[0];
    expect(section).toBeDefined();
    expect(section.classes.map((c) => c.tahunFrom)).toEqual(['TAHUN 1', 'TAHUN 2']);
    expect(section.classes.map((c) => c.subjects)).toEqual([
      [{ name: 'BAHASA MELAYU', qty: 5 }, { name: 'MATEMATIK', qty: 2 }],
      [{ name: 'BAHASA MELAYU', qty: 3 }, { name: 'MATEMATIK', qty: 4 }],
    ]);

    const cat = resolveCategory(dynKey);
    expect(cat.mode).toBe('dynamicMatrix');
    expect(cat.label).toBe('PENCAPAIAN AKADEMIK');
  });
});

describe('a renamed SUBJEK-shaped sheet — import → cart → CSV (dynamicMatrix end-to-end)', () => {
  // Same fixture as the detection test above.
  const rows = [];
  rows[0] = [null, null, 'TOLONG ISI DI SINI'];
  rows[1] = [null, null, 'HARI ANUGERAH 2026'];
  rows[2] = [null, null, 'PENCAPAIAN AKADEMIK TERBAIK'];
  rows[5] = ['SUBJEK'];
  rows[6] = [null, 'TAHUN 1', 'TAHUN 2'];
  rows[7] = ['BAHASA MELAYU', 5, 3];
  rows[8] = ['MATEMATIK', 2, 4];
  rows[9] = ['TOTAL', 7, 7];
  const catalog = [{ code: 'DECO LIGHT', price: 5, stockQty: 1e6, stockBaseline: 1e6 }];
  const dynKey = makeDynamicCategoryKey('KLAS_MATRIX', 'PENCAPAIAN AKADEMIK');

  // Minimal replica of AppState.importFormAnugerahExcel's new
  // `cat.mode === 'dynamicMatrix'` branch (the same rows-as-subjects +
  // columns-as-classes shape populateMatrixSectionBlock/the KLAS_MATRIX
  // multi-section import already use) — proves the SAME downstream
  // pipeline (computeBlocks/buildCategoryCartItems/buildCsvRows) that
  // already serves the fixed 'KLAS_MATRIX' key handles a dynamically
  // resolved one identically, since none of them branch on the literal key.
  const buildDraft = (section) => {
    const key = `${dynKey}::0`;
    let id = 1;
    const presentNames = [...new Set(section.classes.flatMap((c) => c.subjects.map((s) => s.name)))];
    const subjectRows = presentNames.map((name) => ({ id: id++, desc: name, custom: true }));
    const rowIdByName = new Map(subjectRows.map((r) => [r.desc, r.id]));
    const classColumns = section.classes.map((cls) => ({ id: id++, tahunFrom: cls.tahunFrom, tahunTo: cls.tahunTo, namaKelas: cls.namaKelas }));
    const matrixValues = {};
    section.classes.forEach((cls, i) => {
      cls.subjects.forEach(({ name, qty }) => {
        matrixValues[`${key}::${rowIdByName.get(name)}::${classColumns[i].id}`] = String(qty);
      });
    });
    const lineValues = {};
    Object.entries(section.lines).forEach(([slot, v]) => { lineValues[`${key}::${slot}`] = v; });
    const plakRows = { [key]: [{ id: id++, jenisPlak: 'DECO LIGHT' }] };
    return {
      lineValues, matrixValues, rowsByBlock: { [key]: subjectRows }, columnsByBlock: { [key]: classColumns },
      plakRows, plakCatalog: catalog, schoolLanguage: 'SK',
    };
  };

  it('renders as a matrix (2 subjects × 2 columns), adds to cart, and exports one CSV row per (subject, class, qty)', () => {
    const section = (parseFormAnugerahExcel(workbookFromSheets({ 'PENCAPAIAN AKADEMIK': rows.map((r) => r || []) })).categorized?.[dynKey] || [])[0];
    const st = buildDraft(section);

    const { isDynamicMatrix } = computeBlocks(dynKey, st.lineValues, st.matrixValues, st.rowsByBlock, st.plakRows, st.columnsByBlock, noopUpdaters, catalog, 'SK');
    expect(isDynamicMatrix).toBe(true);

    const res = buildCategoryCartItems(st, dynKey);
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].categoryKey).toBe(dynKey);

    const { rows: csvRows } = buildCsvRows({ schoolLanguage: 'SK', items: res.items }, dynKey, res.items);
    // 2 subjects × 2 classes, quantities 5+2 (TAHUN 1) + 3+4 (TAHUN 2) = 14 rows total.
    expect(csvRows).toHaveLength(14);
    expect(csvRows.every((r) => r[0] === 'HARI ANUGERAH 2026' && r[1] === '')).toBe(true);
    expect(csvRows.filter((r) => r[2].includes('BAHASA MELAYU'))).toHaveLength(5 + 3);
    expect(csvRows.filter((r) => r[2].includes('MATEMATIK'))).toHaveLength(2 + 4);
  });
});

describe('parseFormAnugerahExcel — two-line TAJUK BESAR', () => {
  it('keeps an in-cell line break (Alt+Enter) as one multi-line value in slot 0, not split into slot 0b', () => {
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
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID 2026\nSK CONTOH');
    expect(section.lines['0b']).toBeUndefined();
  });

  it('a THREE-line TAJUK BESAR (a TOKOH sheet, say) keeps all three lines together in slot 0, not squashed onto one line', () => {
    const buf = workbookFromSheets({
      TOKOH: [
        [null, null, null, 'TOLONG ISI DI SINI'],
        [null, null, null, 'SK SEREMBAN JAYA\nHARI ANUGERAH KECEMERLANGAN\n2026'],
        [null, null, null, 'TOKOH MURID'],
        [],
        [],
        ['TOKOH', 'NAMA MURID', 'GAMBAR (YES/NO)', 'KUANTITI', 'JENIS PLAK'],
        ['TOKOH MURID', 'Ali', 'YES', 1, 'DECO LIGHT'],
      ],
    });
    const section = (parseFormAnugerahExcel(buf).categorized?.TOKOH_SHEET || [])[0];
    expect(section.lines['0']).toBe('SK SEREMBAN JAYA\nHARI ANUGERAH KECEMERLANGAN\n2026');
    expect(section.lines['0b']).toBeUndefined();
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
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID 2026\nSK CONTOH');
    expect(section.lines['0b']).toBeUndefined();
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
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID\nSK CONTOH');
    expect(section.lines['0b']).toBeUndefined();
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
    expect(section.lines['0']).toBe('HARI ANUGERAH KECEMERLANGAN MURID\nSK CONTOH');
    expect(section.lines['0b']).toBeUndefined();
  });
});

describe('computeBlocks — TAJUK BESAR + 0b share one number', () => {
  it('slot 0b shares slot 0\'s own number instead of taking the next one, and a hidden 2b leaves no gap', () => {
    // Mirrors a real TOKOH sheet: TAJUK BESAR written across 3 lines (an
    // Alt+Enter split gives slot 0 + slot 0b), ACARA (slot 2), TAHUN (slot
    // 3), and TOKOH's own always-blank SUBJEK/POSITION second box (slot
    // 2b) hidden outright by the import — the numbered list the teacher
    // sees should read 1 (both title lines), 2, 3 — not 1, 2, 3, 5.
    const catKey = 'TOKOH_SHEET';
    const b = 0;
    const lineValues = {
      [`${catKey}::${b}::0`]: 'SK SEREMBAN JAYA',
      [`${catKey}::${b}::0b`]: 'HARI ANUGERAH KECEMERLANGAN\n2026',
      [`${catKey}::${b}::2`]: 'ANUGERAH MURID TERBILANG KOKURIKULUM',
      [`${catKey}::${b}::3`]: 'TAHUN 2026',
      [`${catKey}::${b}::hiddenLines`]: '2b',
    };
    const rowsByBlock = { [`${catKey}::${b}`]: [{ id: 1, desc: 'KETUA MURID', qty: '1', jenisPlak: 'DECO LIGHT' }] };
    const plakRows = { [`${catKey}::${b}`]: [] };
    const catalog = [{ code: 'DECO LIGHT', price: 5, stockQty: 10, stockBaseline: 10 }];
    const { blocks } = computeBlocks(catKey, lineValues, {}, rowsByBlock, plakRows, {}, noopUpdaters, catalog, 'SK');
    const byValue = new Map(blocks[0].lines.map((ln) => [ln.value, ln.num]));
    expect(byValue.get('SK SEREMBAN JAYA')).toBe(1);
    expect(byValue.get('HARI ANUGERAH KECEMERLANGAN\n2026')).toBe(1);
    expect(byValue.get('ANUGERAH MURID TERBILANG KOKURIKULUM')).toBe(2);
    expect(byValue.get('TAHUN 2026')).toBe(3);
    expect(blocks[0].lines.some((ln) => ln.slotId === '2b')).toBe(false);
  });
});
