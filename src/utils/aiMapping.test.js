import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbookIr, renderIrText, sha256Hex } from './fileIr';
import { applyAiMapping } from './aiMapping';
import { makeDynamicCategoryKey } from '../data/catalog';

function workbook(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, { aoa, merges, patch }]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (merges) ws['!merges'] = merges.map((r) => XLSX.utils.decode_range(r));
    if (patch) patch(ws);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });
  return wb;
}
const key = (label) => makeDynamicCategoryKey('KLAS_MATRIX', label);

const LIST_SHEET = {
  aoa: [
    ['SENARAI HADIAH'],
    ['NO', 'ANUGERAH', 'KELAS', 'KUANTITI', 'KOD'],
    [1, 'ANUGERAH KEDUDUKAN KELAS', 'TAHUN 1 MAWAR', 2, 'CODE: PK 1 RM 30'],
    [2, 'ANUGERAH KEDUDUKAN KELAS', 'TAHUN 1 MELUR', 'SATU', 'PK 1'],
    [3, 'ANUGERAH KHAS', 'TOKOH SUKAN', 1, 'PK 2'],
    ['', 'JUMLAH', '', 5, ''],
  ],
};
const MATRIX_SHEET = {
  aoa: [
    ['ANUGERAH MATA PELAJARAN TERBAIK'],
    ['KOD: SM-1 RM 20'],
    ['SUBJEK', 'TAHUN 1 MAWAR', 'TAHUN 1 MELUR'],
    ['BAHASA MELAYU', 1, 1],
    ['MATEMATIK', 1, ''],
    ['JUMLAH', 2, 1],
  ],
  merges: ['A1:C1'],
};

describe('fileIr', () => {
  it('keeps every non-empty cell, merges and blank formulas, in a stable text view', async () => {
    const wb = workbook({
      LIST: LIST_SHEET,
      MATRIX: { ...MATRIX_SHEET, patch: (ws) => { ws.C5 = { t: 'n', f: 'SUM(1,1)' }; } },
      EMPTY: { aoa: [['', '---']] },
    });
    const ir = buildWorkbookIr(wb, ['LIST', 'MATRIX', 'EMPTY', 'MISSING']);
    expect(ir.blocks.map((b) => b.name)).toEqual(['LIST', 'MATRIX']);
    const matrix = ir.blocks[1];
    expect(matrix.cells.B3).toBe('TAHUN 1 MAWAR');
    expect(matrix.merges).toEqual(['A1:C1']);
    expect(matrix.formulaNoValue).toEqual(['C5']);
    const text = renderIrText(ir);
    expect(text).toContain('=== SHEET "MATRIX" ===');
    expect(text).toContain('r4: A=BAHASA MELAYU | B=1 | C=1');
    expect(text).toContain('formula cells with no saved value (read as blank): C5');
    expect(renderIrText(buildWorkbookIr(wb, ['LIST', 'MATRIX']))).toBe(text);
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('applyAiMapping', () => {
  const ir = buildWorkbookIr(workbook({ LIST: LIST_SHEET, MATRIX: MATRIX_SHEET }), ['LIST', 'MATRIX']);

  it('reads values from the file itself by the AI-given refs', () => {
    const res = applyAiMapping(ir, {
      blocks: [
        { sheet: 'LIST', role: 'award-list', titleCell: null, codeCell: null, headerRow: 2, firstRow: 3, lastRow: 6, wordingColumns: ['B', 'C'], qtyColumn: 'D', codeColumn: 'E', labelColumn: null, classColumns: [], confidence: 'high', note: null },
        { sheet: 'MATRIX', role: 'class-matrix', titleCell: 'A1', codeCell: 'A2', headerRow: 3, firstRow: 4, lastRow: 6, wordingColumns: [], qtyColumn: null, codeColumn: null, labelColumn: 'A', classColumns: ['B', 'C'], confidence: 'high', note: null },
      ],
      questions: [],
    });
    expect(Object.keys(res.categorized)).toEqual([key('MATRIX'), key('ANUGERAH KEDUDUKAN KELAS'), key('ANUGERAH KHAS')]);
    const [kelas] = res.categorized[key('ANUGERAH KEDUDUKAN KELAS')];
    expect(kelas.jenisPlak).toBe('PK 1');
    expect(kelas.classes).toEqual([{ tahunFrom: '', tahunTo: '', namaKelas: 'TAHUN 1 MAWAR', eline2: '', subjects: [{ name: 'KUANTITI', qty: 2 }] }]);
    const [mp] = res.categorized[key('MATRIX')];
    expect(mp.lines).toEqual({ 2: 'ANUGERAH MATA PELAJARAN TERBAIK' });
    expect(mp.jenisPlak).toBe('SM-1');
    expect(mp.classes).toEqual([
      { tahunFrom: 'TAHUN 1', tahunTo: 'TAHUN 1', namaKelas: 'MAWAR', subjects: [{ name: 'BAHASA MELAYU', qty: 1 }, { name: 'MATEMATIK', qty: 1 }] },
      { tahunFrom: 'TAHUN 1', tahunTo: 'TAHUN 1', namaKelas: 'MELUR', subjects: [{ name: 'BAHASA MELAYU', qty: 1 }] },
    ]);
    // SATU is not a number (asked, not guessed); JUMLAH 5 vs 3 read rows.
    expect(res.notes).toEqual([
      'Sheet "LIST", row 4: couldn\'t read the quantity "SATU" for "ANUGERAH KEDUDUKAN KELAS / TAHUN 1 MELUR" — please add it by hand.',
      'Sheet "LIST", row 6: the sheet\'s JUMLAH/TOTAL says 5, but the rows above it add up to 3 — please check nothing is missing.',
    ]);
  });

  it('turns unusable or unsure answers into notes instead of data', () => {
    const res = applyAiMapping(ir, {
      blocks: [
        { sheet: 'LIST', role: 'award-list', titleCell: null, codeCell: null, headerRow: 2, firstRow: 3, lastRow: 99, wordingColumns: ['B'], qtyColumn: 'D', codeColumn: null, labelColumn: null, classColumns: [], confidence: 'high', note: null },
        { sheet: 'NOPE', role: 'ignore', titleCell: null, codeCell: null, headerRow: null, firstRow: null, lastRow: null, wordingColumns: [], qtyColumn: null, codeColumn: null, labelColumn: null, classColumns: [], confidence: 'high', note: null },
      ],
      questions: [{ sheet: 'MATRIX', text: 'Is row 6 a total?' }],
    });
    expect(res.categorized).toEqual({});
    expect(res.notes).toEqual([
      'Sheet "LIST": the AI gave a row range (3–99) that isn\'t inside this sheet — please add it by hand.',
      'Sheet "NOPE": the AI named a sheet that isn\'t in this file — ignored.',
      'Sheet "LIST": the AI didn\'t read this sheet — please add its data by hand if needed.',
      'Sheet "MATRIX": the AI didn\'t read this sheet — please add its data by hand if needed.',
      'Sheet "MATRIX": Is row 6 a total?',
    ]);
  });

  it('puts a ceremony title in TAJUK BESAR and keeps a plain award title as the award', () => {
    const list = (title) => ({ aoa: [[title], [], ['ANUGERAH', 'KELAS', 'KUANTITI'], ['MURID CEMERLANG', 'TAHUN 6 BESTARI', 3], ['MURID CEMERLANG', 'TAHUN 6 CERDAS', 2]] });
    const ir3 = buildWorkbookIr(workbook({ EVENT: list('MAJLIS ANUGERAH KECEMERLANGAN 2026'), AWARD: list('ANUGERAH TOKOH') }), ['EVENT', 'AWARD']);
    const block = (sheet) => ({ sheet, role: 'award-list', titleCell: 'A1', codeCell: null, headerRow: 3, firstRow: 4, lastRow: 5, wordingColumns: ['A', 'B'], qtyColumn: 'C', codeColumn: null, labelColumn: null, classColumns: [], confidence: 'high', note: null });
    const res = applyAiMapping(ir3, { blocks: [block('EVENT'), block('AWARD')], questions: [] });
    const [event] = res.categorized[key('MURID CEMERLANG')];
    expect(event.lines).toEqual({ 0: 'MAJLIS ANUGERAH KECEMERLANGAN 2026', 2: 'MURID CEMERLANG' });
    expect(event.classes.map((c) => [c.namaKelas, c.subjects[0].qty])).toEqual([['TAHUN 6 BESTARI', 3], ['TAHUN 6 CERDAS', 2]]);
    const [award] = res.categorized[key('ANUGERAH TOKOH')];
    expect(award.lines).toEqual({ 2: 'ANUGERAH TOKOH' });
    expect(award.classes.reduce((n, c) => n + c.subjects.reduce((m, s) => m + s.qty, 0), 0)).toBe(5);
  });

  it('flags a low-confidence block and blank formula quantities', () => {
    const wb = workbook({ LIST: { ...LIST_SHEET, patch: (ws) => { ws.D5 = { t: 'n', f: 'A1+1' }; } } });
    const ir2 = buildWorkbookIr(wb, ['LIST']);
    const res = applyAiMapping(ir2, {
      blocks: [{ sheet: 'LIST', role: 'award-list', titleCell: null, codeCell: null, headerRow: 2, firstRow: 3, lastRow: 5, wordingColumns: ['B', 'C'], qtyColumn: 'D', codeColumn: 'E', labelColumn: null, classColumns: [], confidence: 'low', note: null }],
      questions: [],
    });
    expect(res.notes[0]).toMatch(/wasn't sure/);
    expect(res.notes.some((n) => /row 5: the quantity for "ANUGERAH KHAS \/ TOKOH SUKAN" is a formula with no saved value/.test(n))).toBe(true);
  });
});
