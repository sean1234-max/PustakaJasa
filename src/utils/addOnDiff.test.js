import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { computeAddOnDiff, buildApplyFilter } from './addOnDiff';
import { buildCategoryCartItems } from '../state/categoryCartItems';
import { customMatrixLabelKey, matrixCellKey } from '../data/catalog';

const catalog = [{ code: 'DECO LIGHT', price: 5, stockQty: 1e6, stockBaseline: 1e6 }];

function workbookFromSheets(sheets) {
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, aoa]) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  });
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

function makeFile(name, buf) {
  return { name, arrayBuffer: async () => buf };
}

// Builds order.items for TOKOH_SHEET directly from {desc, namaMurid, qty?}
// rows — same shape src/state/AppState.jsx's importFormAnugerahExcelInto
// builds from section.tokohRows.
function tokohOrderItems(rows) {
  const key = 'TOKOH_SHEET::0';
  let id = 1;
  const rowsByBlock = {
    [key]: rows.map((r) => ({
      id: id++, desc: r.desc, qty: String(r.qty ?? 1), jenisPlak: 'DECO LIGHT', namaMurid: r.namaMurid || '', gambar: '', design: '',
    })),
  };
  const lineValues = { [`${key}::0`]: 'TAJUK BESAR', [`${key}::2`]: 'ACARA' };
  const st = { lineValues, matrixValues: {}, rowsByBlock, plakRows: {}, columnsByBlock: {}, plakCatalog: catalog, schoolLanguage: 'SK' };
  return buildCategoryCartItems(st, 'TOKOH_SHEET').items;
}

// Builds order.items for a plakPerRow TAHUN-list category (LONJAKAN/
// KEHADIRAN) from {desc, qty} rows.
function simpleTahunOrderItems(catKey, rows) {
  const key = `${catKey}::0`;
  let id = 1;
  const rowsByBlock = { [key]: rows.map((r) => ({ id: id++, desc: r.desc, qty: String(r.qty ?? 0), jenisPlak: 'DECO LIGHT' })) };
  const lineValues = { [`${key}::0`]: 'TAJUK BESAR', [`${key}::2`]: 'ACARA' };
  const st = { lineValues, matrixValues: {}, rowsByBlock, plakRows: { [key]: [] }, columnsByBlock: {}, plakCatalog: catalog, schoolLanguage: 'SK' };
  return buildCategoryCartItems(st, catKey).items;
}

// Builds order.items for a subjectsFromImport fixed-matrix category (PPKI/
// MP THP/...) from `[{ column, subjects: [{ name, qty }] }]` — same
// construction as AppState.jsx's `cat.subjectsFromImport` branch.
function matrixOrderItems(catKey, classes) {
  let nextRowId = 1;
  const matrixValues = {};
  const rowIdByName = new Map();
  const subjectOrder = [...new Set(classes.flatMap((c) => c.subjects.map((s) => s.name)))];
  subjectOrder.forEach((name) => {
    const rowId = nextRowId++;
    rowIdByName.set(name, rowId);
    matrixValues[customMatrixLabelKey(catKey, rowId)] = name;
  });
  classes.forEach(({ column, subjects }) => {
    subjects.forEach(({ name, qty }) => {
      if (!qty) return;
      matrixValues[matrixCellKey(catKey, `custom-${rowIdByName.get(name)}`, column)] = String(qty);
    });
  });
  const key = `${catKey}::0`;
  const lineValues = { [`${key}::0`]: 'TAJUK BESAR', [`${key}::2`]: 'ACARA' };
  const st = { lineValues, matrixValues, rowsByBlock: {}, plakRows: { [key]: [{ id: 1, jenisPlak: 'DECO LIGHT' }] }, columnsByBlock: {}, plakCatalog: catalog, schoolLanguage: 'SK' };
  return buildCategoryCartItems(st, catKey).items;
}

function tokohWorkbook(rows) {
  return workbookFromSheets({
    TOKOH: [
      [null, null, null, 'TOLONG ISI DI SINI'],
      [null, null, null, 'TAJUK BESAR'],
      [null, null, null, 'TOKOH MURID'],
      [],
      [],
      ['TOKOH', 'NAMA MURID', 'GAMBAR (YES/NO)', 'KUANTITI', 'JENIS PLAK'],
      ...rows.map((r) => [r.desc, r.namaMurid, 'YES', r.qty ?? 1, 'DECO LIGHT']),
    ],
  });
}

function lonjakanWorkbook(rows) {
  return workbookFromSheets({
    'LONJAKAN SAUJANA': [
      ['TAHUN', 'KUANTITI', 'JENIS PLAK'],
      ...rows.map((r) => [r.desc, r.qty, 'DECO LIGHT']),
    ],
  });
}

function mpThp2Workbook(subject, qtysByTahun) {
  return workbookFromSheets({
    'MP THP 2': [
      [null, 'TAJUK BESAR'],
      [null, 'ACARA'],
      [null, subject],
      [null, 'TAHUN 4'],
      ['SUBJEK', 'KUANTITI'],
      [null, 'TAHUN 4', 'TAHUN 5', 'TAHUN 6'],
      [subject, qtysByTahun[0], qtysByTahun[1], qtysByTahun[2]],
      ['TOTAL', qtysByTahun[0], qtysByTahun[1], qtysByTahun[2]],
      [null, 'JENIS PLAK', 'QTY', 'HARGA'],
      [null, 'DECO LIGHT', 15],
    ],
  });
}

describe('computeAddOnDiff — brand-new category', () => {
  it('short-circuits: every row is new, nothing diffed', async () => {
    const order = { items: [] }; // SELEMPANG-only order, say — TOKOH is wholly new
    const diff = await computeAddOnDiff(makeFile('x.xlsx', tokohWorkbook([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }])), order, catalog);
    expect(diff.ok).toBe(true);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'TOKOH_SHEET');
    expect(entry.isNewCategory).toBe(true);
    expect(entry.flaggedMissing).toEqual([]);
  });
});

describe('computeAddOnDiff — TOKOH name+award matching', () => {
  it('matches existing rows by name+award, flags a new one', async () => {
    const order = { items: tokohOrderItems([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }, { desc: 'Tokoh Akademik', namaMurid: 'Ben' }]) };
    const file = makeFile('x.xlsx', tokohWorkbook([
      { desc: 'Tokoh Sukan', namaMurid: 'Ali' },
      { desc: 'Tokoh Akademik', namaMurid: 'Ben' },
      { desc: 'Tokoh Seni', namaMurid: 'Chan' },
    ]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'TOKOH_SHEET');
    expect(entry.isNewCategory).toBe(false);
    expect(entry.newRows).toEqual([{ desc: 'Tokoh Seni', namaMurid: 'Chan', qty: 1, jenisPlak: 'DECO LIGHT', gambar: 'YES', design: '' }]);
    expect(entry.skippedRows).toHaveLength(2);
    expect(entry.flaggedMissing).toEqual([]);
  });

  it('same name, different award is a NEW row, not a match (no class field to disambiguate)', async () => {
    const order = { items: tokohOrderItems([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }]) };
    const file = makeFile('x.xlsx', tokohWorkbook([{ desc: 'Tokoh Akademik', namaMurid: 'Ali' }]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'TOKOH_SHEET');
    expect(entry.newRows).toHaveLength(1);
    expect(entry.newRows[0]).toMatchObject({ desc: 'Tokoh Akademik', namaMurid: 'Ali' });
    // The original Sukan/Ali row never appeared in this upload, so it's flagged.
    expect(entry.flaggedMissing).toEqual([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }]);
  });

  it('a row missing from the new upload is flagged, never removed', async () => {
    const order = { items: tokohOrderItems([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }, { desc: 'Tokoh Akademik', namaMurid: 'Ben' }]) };
    const file = makeFile('x.xlsx', tokohWorkbook([{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'TOKOH_SHEET');
    expect(entry.newRows).toEqual([]);
    expect(entry.flaggedMissing).toEqual([{ desc: 'Tokoh Akademik', namaMurid: 'Ben' }]);

    // Confirm applying this diff never references the flagged row at all.
    const filter = buildApplyFilter(diff);
    const maps = { newLineValues: {}, newMatrixValues: {}, newRowsByBlock: { 'TOKOH_SHEET::0': [{ desc: 'Tokoh Sukan', namaMurid: 'Ali' }] }, newPlakRows: {} };
    filter('TOKOH_SHEET', 'TOKOH_SHEET::0', maps);
    expect(maps.newRowsByBlock['TOKOH_SHEET::0']).toEqual([]); // Ali already existed -> filtered out, Ben never appears anywhere
  });
});

describe('computeAddOnDiff — qty-list (LONJAKAN/KEHADIRAN)', () => {
  it('a quantity increase becomes a delta-only new row, not the full new quantity', async () => {
    const order = { items: simpleTahunOrderItems('LONJAKAN', [{ desc: 'TAHUN 1', qty: 5 }]) };
    const file = makeFile('x.xlsx', lonjakanWorkbook([{ desc: 'TAHUN 1', qty: 8 }]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'LONJAKAN');
    expect(entry.newRows).toEqual([{ desc: 'TAHUN 1', delta: 3, oldQty: 5, newQty: 8 }]);

    const filter = buildApplyFilter(diff);
    const maps = { newLineValues: {}, newMatrixValues: {}, newRowsByBlock: { 'LONJAKAN::0': [{ desc: 'TAHUN 1', qty: '8' }] }, newPlakRows: {} };
    filter('LONJAKAN', 'LONJAKAN::0', maps);
    // Applying writes only the +3 delta, never the full new qty of 8 — the
    // exact double-counting bug this feature exists to prevent.
    expect(maps.newRowsByBlock['LONJAKAN::0']).toEqual([{ desc: 'TAHUN 1', qty: '3' }]);
  });

  it('a quantity decrease is flagged, excluded entirely from newRows (not a negative delta)', async () => {
    const order = { items: simpleTahunOrderItems('LONJAKAN', [{ desc: 'TAHUN 1', qty: 8 }]) };
    const file = makeFile('x.xlsx', lonjakanWorkbook([{ desc: 'TAHUN 1', qty: 5 }]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'LONJAKAN');
    expect(entry.newRows).toEqual([]);
    expect(entry.flaggedMissing).toEqual([{ desc: 'TAHUN 1', oldQty: 8, newQty: 5, decreased: true }]);
  });
});

describe('computeAddOnDiff — fixed subject/class matrix (PPKI/MP THP)', () => {
  it('a cell quantity increase becomes a delta only', async () => {
    const order = { items: matrixOrderItems('MP2', [{ column: 'TAHUN 4', subjects: [{ name: 'BAHASA MELAYU', qty: 5 }] }]) };
    const file = makeFile('x.xlsx', mpThp2Workbook('BAHASA MELAYU', [8, 0, 0]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'MP2');
    expect(entry.kind).toBe('matrix');
    expect(entry.matrixDelta).toEqual([{ subject: 'BAHASA MELAYU', col: 'TAHUN 4', oldQty: 5, newQty: 8, delta: 3 }]);
    expect(entry.matrixFlagged).toEqual([]);
  });

  it('a cell quantity decrease is flagged and excluded from matrixDelta', async () => {
    const order = { items: matrixOrderItems('MP2', [{ column: 'TAHUN 4', subjects: [{ name: 'BAHASA MELAYU', qty: 8 }] }]) };
    const file = makeFile('x.xlsx', mpThp2Workbook('BAHASA MELAYU', [5, 0, 0]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'MP2');
    expect(entry.matrixDelta).toEqual([]);
    expect(entry.matrixFlagged).toEqual([{ subject: 'BAHASA MELAYU', col: 'TAHUN 4', oldQty: 8, newQty: 5, decreased: true }]);
  });

  it('applying resolves the custom-<id> row key back to the real subject label before matching', async () => {
    const order = { items: matrixOrderItems('MP2', [{ column: 'TAHUN 4', subjects: [{ name: 'BAHASA MELAYU', qty: 5 }] }]) };
    const file = makeFile('x.xlsx', mpThp2Workbook('BAHASA MELAYU', [8, 0, 0]));
    const diff = await computeAddOnDiff(file, order, catalog);
    const filter = buildApplyFilter(diff);
    // Simulate what importFormAnugerahExcelInto's re-parse of the SAME file
    // would have built for this category, before filtering.
    const rowId = 42;
    const maps = {
      newLineValues: { [customMatrixLabelKey('MP2', rowId)]: 'BAHASA MELAYU' },
      newMatrixValues: { [matrixCellKey('MP2', `custom-${rowId}`, 'TAHUN 4')]: '8' },
      newRowsByBlock: {},
      newPlakRows: {},
    };
    filter('MP2', 'MP2::0', maps);
    expect(maps.newMatrixValues[matrixCellKey('MP2', `custom-${rowId}`, 'TAHUN 4')]).toBe('3');
  });
});

describe('computeAddOnDiff — unsupported category shapes never auto-apply', () => {
  it('an existing SELEMPANG category is flagged for manual review, nothing applied', async () => {
    const order = { items: [{ id: '1', categoryKey: 'SELEMPANG', blockIdx: 0, jenisPlak: 'DECO LIGHT', qty: 1, harga: 5, unitPrice: 5, categoryLabel: 'Selempang', detail: {} }] };
    const file = makeFile('x.xlsx', workbookFromSheets({
      SELEMPANG: [['ACARA', 'WARNA', 'KUANTITI'], ['Pengawas', 'Merah', 5]],
    }));
    const diff = await computeAddOnDiff(file, order, catalog);
    const entry = diff.perCategory.find((c) => c.categoryKey === 'SELEMPANG');
    expect(entry.kind).toBe('unsupported');

    const filter = buildApplyFilter(diff);
    const maps = { newLineValues: {}, newMatrixValues: { 'SELEMPANG::0::foo': '5' }, newRowsByBlock: { 'SELEMPANG::0': [{ acara: 'Pengawas' }] }, newPlakRows: {} };
    filter('SELEMPANG', 'SELEMPANG::0', maps);
    expect(maps.newRowsByBlock['SELEMPANG::0']).toEqual([]);
    expect(maps.newMatrixValues).toEqual({});
  });
});
