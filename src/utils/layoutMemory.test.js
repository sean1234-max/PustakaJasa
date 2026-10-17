import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildWorkbookIr, renderIrText } from './fileIr';
import { applyAiMapping } from './aiMapping';
import { layoutFromBlock, layoutKey, matchLayout, parseIrSheets } from '../../supabase/functions/read-order-file/layoutMemory.ts';

// Layout memory: what the AI learns from one school's sheet is reused for
// another school's sheet with the same layout — and only then.

function irOf(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, aoa]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name));
  const ir = buildWorkbookIr(wb, Object.keys(sheets));
  return { ir, text: renderIrText(ir) };
}
const totalQty = (categorized) => Object.values(categorized).flat()
  .reduce((n, s) => n + s.classes.reduce((m, c) => m + c.subjects.reduce((k, x) => k + x.qty, 0), 0), 0);

// School A, read by the AI once.
const SCHOOL_A = [
  ['MAJLIS ANUGERAH SK TAMAN A 2026'],
  ['ANUGERAH CEMERLANG'],
  [],
  ['BIL', 'NAMA KELAS', 'KUANTITI', 'KOD'],
  [1, '1 MAWAR', 3, 'PK 1'],
  [2, '1 MELUR', 2, 'PK 1'],
  ['', 'JUMLAH', 5, ''],
];
const AI_BLOCK = {
  sheet: 'BORANG', role: 'award-list', headingCells: ['A1'], titleCell: 'A2', fixedCells: [], codeCell: null,
  headerRow: 4, firstRow: 5, lastRow: 7, wordingColumns: ['B'], qtyColumn: 'C', codeColumn: 'D',
  labelColumn: null, classColumns: [], confidence: 'high', note: null,
};

// School B, never seen: same form, other school, more rows, and a price
// table further down that is not part of the order.
const SCHOOL_B = [
  ['MAJLIS PERSEMBAHAN SK BUKIT B 2026'],
  ['ANUGERAH KHAS GURU BESAR'],
  [],
  ['BIL', 'NAMA KELAS', 'KUANTITI', 'KOD'],
  [1, '2 ANGGERIK', 4, 'PK 2'],
  [2, '2 KEMBOJA', 1, 'PK 2'],
  [3, '3 RAYA', 2, 'PK 2'],
  [4, '4 CEMPAKA', 6, 'PK 2'],
  ['', 'JUMLAH', 13, ''],
  [],
  ['', 'JENIS PLAK', 99, 'HARGA'],
];

describe('learning a layout', () => {
  const a = parseIrSheets(irOf({ BORANG: SCHOOL_A }).text)[0];
  const layout = layoutFromBlock(AI_BLOCK, a);

  it('reads the sheets back from the text the AI was sent', () => {
    expect(a.name).toBe('BORANG');
    expect(a.cells.get('C4')).toBe('KUANTITI');
    expect(a.maxRow).toBe(7);
    expect(a.section.startsWith('=== SHEET "BORANG" ===')).toBe(true);
  });

  it('keeps only the headers and the column roles — no school, class or quantity', () => {
    expect(layout.anchors).toEqual([{ ref: 'B4', text: 'NAMA KELAS' }, { ref: 'C4', text: 'KUANTITI' }, { ref: 'D4', text: 'KOD' }]);
    expect(layout.present).toEqual(['A2', 'A1']);
    const saved = JSON.stringify(layout);
    ['TAMAN A', 'MAWAR', 'MELUR', 'CEMERLANG', 'PK 1'].forEach((word) => expect(saved).not.toContain(word));
    expect(layoutKey(layout)).toBe(layoutKey(layoutFromBlock({ ...AI_BLOCK, lastRow: 99 }, a)));
  });

  it('learns nothing the AI was not sure of', () => {
    expect(layoutFromBlock({ ...AI_BLOCK, confidence: 'medium' }, a)).toBeNull();
    expect(layoutFromBlock({ ...AI_BLOCK, note: 'Check row 6' }, a)).toBeNull();
    expect(layoutFromBlock({ ...AI_BLOCK, headerRow: null }, a)).toBeNull();
    expect(layoutFromBlock({ ...AI_BLOCK, role: 'ignore' }, a)).toBeNull();
    // A quantity column with no header to recognise it by.
    expect(layoutFromBlock({ ...AI_BLOCK, qtyColumn: 'E' }, a)).toBeNull();
  });

  it('reads another school\'s sheet with the same layout, with no AI', () => {
    const { ir, text } = irOf({ 'ORDER 2026': SCHOOL_B });
    const block = matchLayout(layout, parseIrSheets(text)[0]);
    expect(block).toMatchObject({ sheet: 'ORDER 2026', firstRow: 5, lastRow: 9, qtyColumn: 'C' });
    const { categorized, notes } = applyAiMapping(ir, { blocks: [block], questions: [] });
    expect(totalQty(categorized)).toBe(13);
    expect(notes).toEqual([]);
    const [section] = Object.values(categorized)[0];
    expect(section.lines['0']).toBe('MAJLIS PERSEMBAHAN SK BUKIT B 2026');
  });

  it('stops after three empty rows when there is no JUMLAH row', () => {
    const noTotal = [...SCHOOL_B.slice(0, 8), [], [], [], ['', 'Nota', 5, '']];
    const block = matchLayout(layout, parseIrSheets(irOf({ X: noTotal }).text)[0]);
    expect(block.lastRow).toBe(8);
  });

  it('does not fit a sheet with other headers, a moved table or no quantities', () => {
    const other = SCHOOL_B.map((r, i) => (i === 3 ? ['BIL', 'NAMA KELAS', 'BILANGAN', 'KOD'] : r));
    expect(matchLayout(layout, parseIrSheets(irOf({ X: other }).text)[0])).toBeNull();
    const moved = [[], ...SCHOOL_B];
    expect(matchLayout(layout, parseIrSheets(irOf({ X: moved }).text)[0])).toBeNull();
    const empty = SCHOOL_B.map((r, i) => (i >= 4 && i <= 7 ? [r[0], r[1], '', r[3]] : r));
    expect(matchLayout(layout, parseIrSheets(irOf({ X: empty }).text)[0])).toBeNull();
    const noTitle = SCHOOL_B.map((r, i) => (i === 1 ? [] : r));
    expect(matchLayout(layout, parseIrSheets(irOf({ X: noTitle }).text)[0])).toBeNull();
  });
});

describe('a class matrix layout', () => {
  const A = [
    ['ANUGERAH MATA PELAJARAN TERBAIK'],
    ['KOD: SM-1'],
    ['SUBJEK', 'TAHUN 1 MAWAR', 'TAHUN 1 MELUR', 'JUMLAH'],
    ['BAHASA MELAYU', 1, 1, 2],
    ['MATEMATIK', 1, '', 1],
    ['JUMLAH', 2, 1, 3],
  ];
  const block = {
    sheet: 'MP', role: 'class-matrix', headingCells: [], titleCell: 'A1', fixedCells: [], codeCell: 'A2',
    headerRow: 3, firstRow: 4, lastRow: 6, wordingColumns: [], qtyColumn: null, codeColumn: null,
    labelColumn: 'A', classColumns: ['B', 'C'], confidence: 'high', note: null,
  };
  const layout = layoutFromBlock(block, parseIrSheets(irOf({ MP: A }).text)[0]);

  it('finds the other school\'s own classes again', () => {
    const B = [
      ['ANUGERAH SUBJEK CEMERLANG'],
      ['KOD: SM-7'],
      ['SUBJEK', '2 BESTARI', '2 CERDAS', '2 DINAMIK', 'JUMLAH'],
      ['SAINS', 1, 1, 1, 3],
      ['JUMLAH', 1, 1, 1, 3],
    ];
    const { ir, text } = irOf({ 'MP B': B });
    const got = matchLayout(layout, parseIrSheets(text)[0]);
    expect(got.classColumns).toEqual(['B', 'C', 'D']);
    // Columns after JUMLAH (HARGA, CATATAN) are not classes.
    const priced = B.map((r, i) => (i === 2 ? [...r, 'HARGA'] : i >= 3 ? [...r, 25] : r));
    expect(matchLayout(layout, parseIrSheets(irOf({ X: priced }).text)[0]).classColumns).toEqual(['B', 'C', 'D']);
    expect(JSON.stringify(layout)).not.toContain('MAWAR');
    const { categorized } = applyAiMapping(ir, { blocks: [got], questions: [] });
    expect(totalQty(categorized)).toBe(3);
  });
});
