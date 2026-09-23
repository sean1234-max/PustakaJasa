import { describe, it, expect } from 'vitest';
import {
  CSV_COLUMNS, rowsToCsv, buildCsvRows, validateExport, buildCategoryCsvFilename, getInvoiceIdForJenisPlak, isReservedName,
  getOrderJenisPlakGroups, getExportableCategories, splitOrderCategories,
  combineCsvRows, buildCombinedCsvFilename,
} from './exportCsv';
import { customMatrixLabelKey, matrixCellKey } from '../data/catalog';

describe('buildCsvRows — PBD (per-recipient, Nama Kelas split)', () => {
  const lines = { 'PBD::0::0': 'HARI ANUGERAH 2026', 'PBD::0::2': 'ANUGERAH PBD' };
  const item = (matrix, namaKelasBreakdown) => ({
    id: 'p1', jenisPlak: 'DECO LIGHT', qty: 3, categoryKey: 'PBD', blockIdx: 0,
    detail: { lines, matrix, namaKelasBreakdown },
  });

  it('one row per (Tahun, Nama Kelas); "PKB" qualifier dropped from the engraved Tahun', () => {
    const it = item(
      {
        [customMatrixLabelKey('PBD', 100)]: 'TAHUN 1 PKB',
        [matrixCellKey('PBD', 'custom-100', 'KUANTITI')]: '3',
      },
      { 'PBD::0::TAHUN 1 PKB::main': [{ id: 1, desc: 'GAGI', qty: '2' }, { id: 2, desc: 'HAZIQ', qty: '1' }] },
    );
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [it] }, 'PBD', [it]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r[3] === 'TAHUN 1 GAGI')).toHaveLength(2);
    expect(rows.filter((r) => r[3] === 'TAHUN 1 HAZIQ')).toHaveLength(1);
    expect(rows.every((r) => r[2] === 'ANUGERAH PBD')).toBe(true); // Tahun is NOT in position
  });

  it('a Tahun with no breakdown falls back to a plain Tahun line, KUANTITI times', () => {
    const it = item({
      [customMatrixLabelKey('PBD', 100)]: 'TAHUN 4',
      [matrixCellKey('PBD', 'custom-100', 'KUANTITI')]: '2',
    }, {});
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [it] }, 'PBD', [it]);
    expect(rows).toEqual([
      ['HARI ANUGERAH 2026', '', 'ANUGERAH PBD', 'TAHUN 4', '', 'DECO LIGHT', 'PBD TERBAIK'],
      ['HARI ANUGERAH 2026', '', 'ANUGERAH PBD', 'TAHUN 4', '', 'DECO LIGHT', 'PBD TERBAIK'],
    ]);
  });

  it('pads with a plain Tahun line when the breakdown covers less than the KUANTITI', () => {
    const it = item(
      {
        [customMatrixLabelKey('PBD', 100)]: 'TAHUN 2',
        [matrixCellKey('PBD', 'custom-100', 'KUANTITI')]: '5',
      },
      { 'PBD::0::TAHUN 2::main': [{ id: 1, desc: 'BESTARI', qty: '3' }] },
    );
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [it] }, 'PBD', [it]);
    expect(rows.filter((r) => r[3] === 'TAHUN 2 BESTARI')).toHaveLength(3);
    expect(rows.filter((r) => r[3] === 'TAHUN 2')).toHaveLength(2); // 5 − 3
  });
});

describe('CSV column remap — reference-sample lines -> CSV columns', () => {
  it('MP THP with a combined line 3 ("TAHUN 1 (BAHASA MELAYU)"): event_line_1 follows the teacher\'s format', () => {
    const item = {
      id: 'm', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'MP1', blockIdx: 0,
      detail: {
        lines: { 'MP1::0::0': 'HARI ANUGERAH', 'MP1::0::1': '2026', 'MP1::0::2': 'TERBAIK MATA PELAJARAN', 'MP1::0::3': 'TAHUN 1 (BAHASA MELAYU)' },
        matrix: { [customMatrixLabelKey('MP1', 9)]: 'BAHASA MELAYU', [matrixCellKey('MP1', 'custom-9', 'TAHUN 1')]: '2' },
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'MP1', [item]);
    expect(rows).toEqual([
      ['HARI ANUGERAH', '', 'TERBAIK MATA PELAJARAN', 'TAHUN 1 (BAHASA MELAYU)', '', 'DECO LIGHT', 'MP THP 1'],
      ['HARI ANUGERAH', '', 'TERBAIK MATA PELAJARAN', 'TAHUN 1 (BAHASA MELAYU)', '', 'DECO LIGHT', 'MP THP 1'],
    ]);
  });

  it('MP THP follows whatever punctuation/order the teacher\'s line 3 uses, per Tahun', () => {
    const mk = (line3, col) => ({
      id: 'm', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'MP2', blockIdx: 0,
      detail: {
        lines: { 'MP2::0::0': 'H', 'MP2::0::2': 'ACARA', 'MP2::0::3': line3 },
        matrix: { [customMatrixLabelKey('MP2', 1)]: 'SAINS', [matrixCellKey('MP2', 'custom-1', col)]: '1' },
      },
    });
    const first = (line3, col) => buildCsvRows({ schoolLanguage: 'SK', items: [mk(line3, col)] }, 'MP2', [mk(line3, col)]).rows[0].slice(2, 4);
    expect(first('TAHUN 4 (BAHASA MELAYU)', 'TAHUN 5')).toEqual(['ACARA', 'TAHUN 5 (SAINS)']);
    expect(first('BAHASA MELAYU - TAHUN 4', 'TAHUN 6')).toEqual(['ACARA', 'SAINS - TAHUN 6']);
  });

  it('MP THP with a Tahun-only line 3 keeps the subject on position (subject on its own line)', () => {
    const item = {
      id: 'm', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'MP2', blockIdx: 0,
      detail: {
        lines: { 'MP2::0::0': 'H', 'MP2::0::2': 'ACARA', 'MP2::0::3': 'TAHUN 4', 'MP2::0::2b': 'BAHASA MELAYU' },
        matrix: { [customMatrixLabelKey('MP2', 1)]: 'SAINS', [matrixCellKey('MP2', 'custom-1', 'TAHUN 5')]: '1' },
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'MP2', [item]);
    expect(rows[0].slice(2, 4)).toEqual(['ACARA\nSAINS', 'TAHUN 5']);
  });

  it('PPKI (matrix) is unchanged: position = ACARA + subject, event_line_1 = bare level', () => {
    const item = {
      id: 'k', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'PPKI', blockIdx: 0,
      detail: {
        lines: { 'PPKI::0::0': 'HARI ANUGERAH', 'PPKI::0::2': 'TERBAIK MATA PELAJARAN' },
        matrix: { [customMatrixLabelKey('PPKI', 9)]: 'BAHASA MELAYU', [matrixCellKey('PPKI', 'custom-9', 'PPKI')]: '1' },
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'PPKI', [item]);
    expect(rows[0].slice(0, 5)).toEqual(['HARI ANUGERAH', '', 'TERBAIK MATA PELAJARAN\nBAHASA MELAYU', 'PPKI', '']);
  });

  it('PBD: the line between 2 and 3 (slot 2b) is appended to position', () => {
    const item = {
      id: 'p', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'PBD', blockIdx: 0,
      detail: {
        lines: { 'PBD::0::0': 'HARI ANUGERAH', 'PBD::0::2': 'ANUGERAH PBD', 'PBD::0::2b': 'TERBAIK KESELURUHAN' },
        matrix: { [customMatrixLabelKey('PBD', 3)]: 'TAHUN 5', [matrixCellKey('PBD', 'custom-3', 'KUANTITI')]: '1' },
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'PBD', [item]);
    expect(rows).toEqual([['HARI ANUGERAH', '', 'ANUGERAH PBD\nTERBAIK KESELURUHAN', 'TAHUN 5', '', 'DECO LIGHT', 'PBD TERBAIK']]);
  });

  it('LONJAKAN: line 2 -> position, each row TAHUN -> event_line_1', () => {
    const item = {
      id: 'l', jenisPlak: 'DECO LIGHT', qty: 3, categoryKey: 'LONJAKAN', blockIdx: 0,
      detail: {
        lines: { 'LONJAKAN::0::0': 'HARI ANUGERAH', 'LONJAKAN::0::2': 'LONJAKAN SAUJANA' },
        rows: [{ id: 1, desc: 'TAHUN 3', qty: '2' }, { id: 2, desc: 'TAHUN 4', qty: '1' }],
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'LONJAKAN', [item]);
    expect(rows).toEqual([
      ['HARI ANUGERAH', '', 'LONJAKAN SAUJANA', 'TAHUN 3', '', 'DECO LIGHT', 'LONJAKAN SAUJANA'],
      ['HARI ANUGERAH', '', 'LONJAKAN SAUJANA', 'TAHUN 3', '', 'DECO LIGHT', 'LONJAKAN SAUJANA'],
      ['HARI ANUGERAH', '', 'LONJAKAN SAUJANA', 'TAHUN 4', '', 'DECO LIGHT', 'LONJAKAN SAUJANA'],
    ]);
  });
});

describe('SELEMPANG stays out of every Production export path', () => {
  const order = {
    schoolLanguage: 'SK',
    items: [
      { id: 'a', categoryKey: 'PPKI', jenisPlak: 'DECO LIGHT', qty: 20, harga: 400 },
      { id: 'b', categoryKey: 'SELEMPANG', jenisPlak: 'SELEMPANG', qty: 30, harga: 1200,
        detail: { rows: [{ id: 1, acara: 'HARI SUKAN', warna: 'BIRU', warnaCode: '0053', qty: '30' }] } },
    ],
  };

  it('getOrderJenisPlakGroups skips the SELEMPANG item', () => {
    const groups = getOrderJenisPlakGroups(order);
    expect(groups.map((g) => g.jenisPlak)).toEqual(['DECO LIGHT']);
  });

  it('getExportableCategories drops SELEMPANG but splitOrderCategories keeps it', () => {
    expect(getExportableCategories(order).map((c) => c.key)).toEqual(['PPKI']);
    const split = splitOrderCategories(order);
    expect(split.anugerah.map((c) => c.key)).toEqual(['PPKI']);
    expect(split.selempang.map((c) => c.key)).toEqual(['SELEMPANG']);
  });
});

describe('getOrderJenisPlakGroups — never combines different categories sharing a Jenis Plak', () => {
  it('MP THP 1 and TOKOH both using DECO LIGHT stay as two groups, not one', () => {
    const order = {
      schoolLanguage: 'SK',
      items: [
        { id: 'a', categoryKey: 'MP1', jenisPlak: 'DECO LIGHT', qty: 20 },
        { id: 'b', categoryKey: 'TOKOH_SHEET', jenisPlak: 'DECO LIGHT', qty: 5 },
      ],
    };
    const groups = getOrderJenisPlakGroups(order);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g.categoryKey, g.jenisPlak, g.items.length])).toEqual([
      ['MP1', 'DECO LIGHT', 1],
      ['TOKOH_SHEET', 'DECO LIGHT', 1],
    ]);
  });

  it('a category using several Jenis Plak within itself (LONJAKAN/TOKOH/KEHADIRAN) splits into one group per Jenis Plak', () => {
    const order = {
      schoolLanguage: 'SK',
      items: [
        { id: 'a', categoryKey: 'LONJAKAN', jenisPlak: 'DECO LIGHT', qty: 5 },
        { id: 'b', categoryKey: 'LONJAKAN', jenisPlak: 'SM-13187 (GOLD/BASE A)', qty: 3 },
        { id: 'c', categoryKey: 'LONJAKAN', jenisPlak: 'H25-1', qty: 4 },
      ],
    };
    const groups = getOrderJenisPlakGroups(order);
    expect(groups.map((g) => g.jenisPlak)).toEqual(['DECO LIGHT', 'SM-13187 (GOLD/BASE A)', 'H25-1']);
    expect(groups.every((g) => g.categoryKey === 'LONJAKAN')).toBe(true);
  });

  it('combines items across batches within the same category + Jenis Plak', () => {
    const order = {
      schoolLanguage: 'SK',
      items: [
        { id: 'a', categoryKey: 'MP1', jenisPlak: 'DECO LIGHT', qty: 20, batch: 0 },
        { id: 'b', categoryKey: 'MP1', jenisPlak: 'DECO LIGHT', qty: 4, batch: 1 },
      ],
    };
    const groups = getOrderJenisPlakGroups(order);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((it) => it.id)).toEqual(['a', 'b']);
  });
});

describe('combineCsvRows — one file for every (category, Jenis Plak) group', () => {
  const order = {
    id: 'ORD-C', invoiceId: 'DWI-1', sekolah: 'SK Seremban Jaya', schoolLanguage: 'SK',
    items: [
      {
        id: 'a', categoryKey: 'MP1', jenisPlak: 'DECO LIGHT', qty: 1,
        detail: {
          lines: { 'MP1::0::0': 'HARI ANUGERAH', 'MP1::0::2': 'ACARA' },
          matrix: { [customMatrixLabelKey('MP1', 1)]: 'BM', [matrixCellKey('MP1', 'custom-1', 'TAHUN 1')]: '1' },
        },
      },
      {
        id: 'b', categoryKey: 'TOKOH_SHEET', jenisPlak: 'CPH / A', qty: 1,
        detail: {
          lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH' },
          rows: [{ id: 1, desc: 'TOKOH NILAM', qty: 1, namaMurid: 'SITI' }],
        },
      },
    ],
  };

  it('flattens every group\'s rows, each still carrying its own category + jenis plak column', () => {
    const groups = getOrderJenisPlakGroups(order).map((g) => ({ ...g, csvData: buildCsvRows(order, null, g.items) }));
    const rows = combineCsvRows(groups);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r[5] === 'DECO LIGHT' && r[6] === 'MP THP 1')).toHaveLength(1);
    expect(rows.filter((r) => r[5] === 'CPH / A' && r[6] === 'TOKOH')).toHaveLength(1);
  });

  it('returns [] for no groups', () => {
    expect(combineCsvRows([])).toEqual([]);
    expect(combineCsvRows(undefined)).toEqual([]);
  });

  it('buildCombinedCsvFilename names the file after the invoice and school, not any one category', () => {
    expect(buildCombinedCsvFilename(order)).toBe('(DWI-1) - SK Seremban Jaya.csv');
  });

  it('buildCombinedCsvFilename falls back to "Combined" when the order has no school name', () => {
    expect(buildCombinedCsvFilename({ ...order, sekolah: '' })).toBe('(DWI-1) - Combined.csv');
  });
});

describe('rowsToCsv', () => {
  it('prepends the fixed header row and joins with CRLF', () => {
    const csv = rowsToCsv([['a', 'b', 'c', 'd', 'e']]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toBe('a,b,c,d,e');
  });

  it('preserves an embedded newline inside quotes (in-cell line break)', () => {
    const csv = rowsToCsv([['h', 'y', 'LINE ONE\nLINE TWO', '', '']]);
    expect(csv).toContain('"LINE ONE\nLINE TWO"');
  });

  it('quotes values containing commas and doubles embedded quotes', () => {
    const csv = rowsToCsv([['a,b', 'say "hi"', '', '', '']]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi"""');
  });

  it('neutralises a leading = + - @ so the cell is not read as a formula', () => {
    const csv = rowsToCsv([['=SUM(A1)', '+1', '-1', '@x', 'ok']]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine.startsWith('\t=SUM(A1)')).toBe(true);
    expect(dataLine).toContain('\t+1');
    expect(dataLine).toContain('\t-1');
    expect(dataLine).toContain('\t@x');
    expect(dataLine.endsWith(',ok')).toBe(true);
  });
});

describe('buildCsvRows — positionFromRows category (Main Template / TOKOH)', () => {
  const item = {
    id: 'i1', jenisPlak: 'CPH / A', qty: 3, categoryKey: 'TOKOH', blockIdx: 0,
    detail: {
      lines: { 'TOKOH::0::0': 'HARI ANUGERAH 2024', 'TOKOH::0::1': '', 'TOKOH::0::2': '' },
      rows: [{ id: 1, desc: 'TOKOH MURID', qty: 2 }, { id: 2, desc: 'TOKOH NILAM', qty: 1 }],
    },
  };
  const order = { id: 'ORD-1', items: [item], schoolLanguage: 'SK' };

  it('emits one row per plaque, position taken from each qty-table row', () => {
    const { rows, skippedItemIds } = buildCsvRows(order, 'TOKOH', [item]);
    expect(skippedItemIds).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r[2] === 'TOKOH MURID')).toHaveLength(2);
    expect(rows.filter((r) => r[2] === 'TOKOH NILAM')).toHaveLength(1);
    expect(rows.every((r) => r[0] === 'HARI ANUGERAH 2024')).toBe(true);
  });

  it('reports an item with no detail via skippedItemIds instead of a blank row', () => {
    const legacy = { id: 'old', jenisPlak: 'CPH / A', qty: 1, categoryKey: 'TOKOH', blockIdx: 0 };
    const { rows, skippedItemIds } = buildCsvRows(
      { ...order, items: [item, legacy] }, 'TOKOH', [item, legacy],
    );
    expect(skippedItemIds).toEqual(['old']);
    expect(rows).toHaveLength(3);
  });

  it('joins a two-line TAJUK BESAR (slot 0 + slot 0b) with a newline in event_header', () => {
    const twoLine = {
      ...item,
      detail: {
        ...item.detail,
        lines: { 'TOKOH::0::0': 'HARI ANUGERAH 2024', 'TOKOH::0::0b': 'SK CONTOH', 'TOKOH::0::1': '', 'TOKOH::0::2': '' },
      },
    };
    const { rows } = buildCsvRows({ ...order, items: [twoLine] }, 'TOKOH', [twoLine]);
    expect(rows.every((r) => r[0] === 'HARI ANUGERAH 2024\nSK CONTOH')).toBe(true);
  });
});

describe('buildCsvRows — TOKOH_SHEET NAMA MURID / Reserved', () => {
  // One cart item per honour row (plakPerRow), each detail carrying just
  // that row — the shape AppState.addToCart produces for TOKOH_SHEET.
  const tokohItem = (id, row) => ({
    id, jenisPlak: 'CPH / A', qty: Number(row.qty) || 0, categoryKey: 'TOKOH_SHEET', blockIdx: 0,
    detail: { lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH 2026', 'TOKOH_SHEET::0::2': '' }, rows: [row] },
  });
  const order = { id: 'ORD-9', schoolLanguage: 'SK' };

  it('a filled NAMA MURID engraves as event_line_1, position stays the TOKOH name', () => {
    const item = tokohItem('a', { id: 1, desc: 'TOKOH MURID', qty: 1, namaMurid: 'AHMAD BIN ALI' });
    const { rows, reservedCount } = buildCsvRows({ ...order, items: [item] }, 'TOKOH_SHEET', [item]);
    expect(reservedCount).toBe(0);
    expect(rows).toEqual([['HARI ANUGERAH 2026', '', 'TOKOH MURID', 'AHMAD BIN ALI', '', 'CPH / A', 'TOKOH']]);
  });

  it('a blank NAMA MURID engraves the TOKOH name qty times, event_line_1 blank', () => {
    const item = tokohItem('b', { id: 2, desc: 'TOKOH NILAM', qty: 3 });
    const { rows } = buildCsvRows({ ...order, items: [item] }, 'TOKOH_SHEET', [item]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r[2] === 'TOKOH NILAM' && r[3] === '')).toBe(true);
  });

  it('a "Reserved" NAMA MURID is left out of the CSV but counted (stock is held elsewhere)', () => {
    const named = tokohItem('n', { id: 1, desc: 'TOKOH MURID', qty: 1, namaMurid: 'SITI' });
    const reserved = tokohItem('r', { id: 2, desc: 'TOKOH AKADEMIK', qty: 2, namaMurid: 'Reserved' });
    const items = [named, reserved];
    const csv = buildCsvRows({ ...order, items }, 'TOKOH_SHEET', items);
    expect(csv.rows).toEqual([['HARI ANUGERAH 2026', '', 'TOKOH MURID', 'SITI', '', 'CPH / A', 'TOKOH']]);
    expect(csv.reservedCount).toBe(2);

    const res = validateExport(order, items, [], csv);
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /Reserved.*held for stock/.test(w))).toBe(true);
  });

  it('a blank NAMA MURID falls back to the reference sample\'s own line ③ text', () => {
    const item = {
      id: 'c', jenisPlak: '18093 GOLD', qty: 1, categoryKey: 'TOKOH_SHEET', blockIdx: 0,
      detail: {
        lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH 2026', 'TOKOH_SHEET::0::2': '', 'TOKOH_SHEET::0::3': 'TAHUN 2026' },
        rows: [{ id: 1, desc: 'PENGAWAS SEKOLAH', qty: 1 }],
      },
    };
    const { rows } = buildCsvRows({ ...order, items: [item] }, 'TOKOH_SHEET', [item]);
    expect(rows).toEqual([['HARI ANUGERAH 2026', '', 'PENGAWAS SEKOLAH', 'TAHUN 2026', '', '18093 GOLD', 'TOKOH']]);
  });

  it('a filled NAMA MURID wins over line ③ — it never mixes with it', () => {
    const item = {
      id: 'd', jenisPlak: '18093 GOLD', qty: 1, categoryKey: 'TOKOH_SHEET', blockIdx: 0,
      detail: {
        lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH 2026', 'TOKOH_SHEET::0::2': '', 'TOKOH_SHEET::0::3': 'TAHUN 2026' },
        rows: [{ id: 1, desc: 'PENGAWAS SEKOLAH', qty: 1, namaMurid: 'AHMAD BIN ALI' }],
      },
    };
    const { rows } = buildCsvRows({ ...order, items: [item] }, 'TOKOH_SHEET', [item]);
    expect(rows[0][3]).toBe('AHMAD BIN ALI');
  });

  it('every case form of "reserved" is treated as a hold', () => {
    ['RESERVED', 'reserved', 'Reserved', '  Reserved  '].forEach((v) => expect(isReservedName(v)).toBe(true));
    ['Reserved for Ali', 'AHMAD', '', undefined].forEach((v) => expect(isReservedName(v)).toBe(false));
  });

  // Mirrors a real filled TOKOH sheet (test_orders/PPKI_SHEET.xlsx):
  //   TOKOH MURID       | (blank)  | 5 | H-25
  //   TOKOH NILAM       | (blank)  | 4 | DECO LIGHT
  //   TOKOH KURIKULUM   | RESERVED | 3 | H-25
  //   TOKOH KOKURIKULUM | SEAN     | 5 | SM-13187 (Silver)
  //   TOKOH AKADEMIK    | CINDY    | 3 | DECO LIGHT
  it('a real mixed sheet: blanks engrave the award name, named rows engrave the name, reserved held back', () => {
    const mk = (id, desc, qty, jenisPlak, namaMurid) => ({
      id, jenisPlak, qty, categoryKey: 'TOKOH_SHEET', blockIdx: 0,
      detail: { lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH KECEMERLANGAN MURID 2026' }, rows: [{ id, desc, qty, ...(namaMurid ? { namaMurid } : {}) }] },
    });
    const items = [
      mk('m', 'TOKOH MURID', 5, 'H-25'),
      mk('n', 'TOKOH NILAM', 4, 'DECO LIGHT'),
      mk('k', 'TOKOH KURIKULUM', 3, 'H-25', 'RESERVED'),
      mk('ko', 'TOKOH KOKURIKULUM', 5, 'SM-13187 (Silver)', 'SEAN'),
      mk('a', 'TOKOH AKADEMIK', 3, 'DECO LIGHT', 'CINDY'),
    ];
    const { rows, reservedCount } = buildCsvRows({ ...order, items }, 'TOKOH_SHEET', items);
    expect(reservedCount).toBe(3);
    expect(rows).toHaveLength(17); // 20 KUANTITI − 3 reserved
    expect(rows.filter((r) => r[2] === 'TOKOH MURID' && r[3] === '')).toHaveLength(5);
    expect(rows.filter((r) => r[2] === 'TOKOH NILAM' && r[3] === '')).toHaveLength(4);
    expect(rows.filter((r) => r[2] === 'TOKOH KURIKULUM')).toHaveLength(0);
    expect(rows.filter((r) => r[2] === 'TOKOH KOKURIKULUM' && r[3] === 'SEAN')).toHaveLength(5);
    expect(rows.filter((r) => r[2] === 'TOKOH AKADEMIK' && r[3] === 'CINDY')).toHaveLength(3);
    expect(rows.every((r) => r[0] === 'HARI ANUGERAH KECEMERLANGAN MURID 2026' && r[1] === '')).toBe(true);
  });

  it('all-Reserved selection: a clear "nothing to engrave yet" error, not the generic one', () => {
    const items = [tokohItem('r', { id: 1, desc: 'TOKOH MURID', qty: 4, namaMurid: 'reserved' })];
    const csv = buildCsvRows({ ...order, items }, 'TOKOH_SHEET', items);
    expect(csv.rows).toHaveLength(0);
    const res = validateExport(order, items, [], csv);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => /still "Reserved"/.test(e))).toBe(true);
    expect(res.errors.some((e) => /every quantity is 0/.test(e))).toBe(false);
  });
});

describe('buildCsvRows — ALIRAN TERBAIK footer qty (derived vs teacher override)', () => {
  // Scenario: Tahun 1-3 flat 5 each (no kedudukan), Tahun 4-6 ranked 1-10.
  const tahunRows = [
    { id: 1, desc: 'TAHUN 1', qty: '5', kedudukanHingga: 0 },
    { id: 2, desc: 'TAHUN 2', qty: '5', kedudukanHingga: 0 },
    { id: 3, desc: 'TAHUN 3', qty: '5', kedudukanHingga: 0 },
    { id: 4, desc: 'TAHUN 4', qty: '10', kedudukanHingga: 10 },
    { id: 5, desc: 'TAHUN 5', qty: '10', kedudukanHingga: 10 },
    { id: 6, desc: 'TAHUN 6', qty: '10', kedudukanHingga: 10 },
  ];
  // Reference-sample mapping for ALIRAN: line 2 (ACARA) -> event_line_1;
  // the line between 2 and 3 (slot 2b), when it has the word "TAHUN" ->
  // per-Tahun event_line_2; line 3 (the ordinal) -> position.
  const mk = (id, jenisPlak, posDari, posHingga, qty, extraLines = {}) => ({
    id, jenisPlak, qty, categoryKey: 'ALIRAN', blockIdx: 0,
    posDari, posHingga,
    detail: {
      lines: { 'ALIRAN::0::0': 'HARI ANUGERAH 2026', 'ALIRAN::0::2': 'ANUGERAH ALIRAN TERBAIK', ...extraLines },
      rows: tahunRows,
    },
  });
  const order = { id: 'ORD-A', schoolLanguage: 'SK' };

  it('derived qty: position = ordinal, event_line_1 = ACARA, event_line_2 = per-Tahun', () => {
    // h25 covers places 4-10 → 7 per ranked Tahun × 3 = 21
    const h25 = mk('h', 'h25', 4, 10, 21, { 'ALIRAN::0::2b': 'TAHUN 1' });
    const { rows } = buildCsvRows({ ...order, items: [h25] }, 'ALIRAN', [h25]);
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r[2] === 'KEEMPAT')).toHaveLength(3);
    expect(rows.every((r) => r[3] === 'ANUGERAH ALIRAN TERBAIK')).toBe(true);
    expect(rows.filter((r) => r[4] === 'TAHUN 4')).toHaveLength(7);
  });

  it('event_line_2 stays blank when the line-2b CONTOH has no "TAHUN" word', () => {
    const h25 = mk('h', 'h25', 4, 10, 21); // no slot 2b
    const { rows } = buildCsvRows({ ...order, items: [h25] }, 'ALIRAN', [h25]);
    expect(rows.every((r) => r[4] === '')).toBe(true);
  });

  it('overridden qty: exactly item.qty rows, ordinals cycle the range, event_line_2 blank', () => {
    // gold covers places 1-3 → derived would be 9; teacher typed 3
    const gold = mk('g', 'sm-13187(gold)', 1, 3, 3, { 'ALIRAN::0::2b': 'TAHUN 1' });
    const { rows } = buildCsvRows({ ...order, items: [gold] }, 'ALIRAN', [gold]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[2])).toEqual(['PERTAMA', 'KEDUA', 'KETIGA']);
    expect(rows.every((r) => r[3] === 'ANUGERAH ALIRAN TERBAIK' && r[4] === '')).toBe(true);
  });

  it('position gets a "TEMPAT " prefix when the line-3 CONTOH is "TEMPAT PERTAMA" instead of plain "PERTAMA"', () => {
    const h25 = mk('h', 'h25', 4, 10, 21, { 'ALIRAN::0::3': 'TEMPAT PERTAMA' });
    const { rows } = buildCsvRows({ ...order, items: [h25] }, 'ALIRAN', [h25]);
    expect(rows.filter((r) => r[2] === 'TEMPAT KEEMPAT')).toHaveLength(3);
    expect(rows.some((r) => r[2] === 'KEEMPAT')).toBe(false);
  });

  it('overridden qty also gets the "TEMPAT " prefix when the CONTOH calls for it', () => {
    const gold = mk('g', 'sm-13187(gold)', 1, 3, 3, { 'ALIRAN::0::3': 'TEMPAT PERTAMA' });
    const { rows } = buildCsvRows({ ...order, items: [gold] }, 'ALIRAN', [gold]);
    expect(rows.map((r) => r[2])).toEqual(['TEMPAT PERTAMA', 'TEMPAT KEDUA', 'TEMPAT KETIGA']);
  });

  it('flat plak row (no range): blank position, one row per plaque of the flat Tahuns', () => {
    const flat = mk('f', 'DECO LIGHT', null, null, 15, { 'ALIRAN::0::2b': 'TAHUN 1' });
    const { rows } = buildCsvRows({ ...order, items: [flat] }, 'ALIRAN', [flat]);
    expect(rows).toHaveLength(15);
    expect(rows.filter((r) => r[4] === 'TAHUN 1')).toHaveLength(5);
    expect(rows.every((r) => r[2] === '' && r[3] === 'ANUGERAH ALIRAN TERBAIK')).toBe(true);
  });

  it('the retired `year` column is always blank', () => {
    const flat = mk('f', 'DECO LIGHT', null, null, 15);
    const { rows } = buildCsvRows({ ...order, items: [flat] }, 'ALIRAN', [flat]);
    expect(rows.every((r) => r[1] === '')).toBe(true);
  });
});

describe('buildCsvRows — ALIRAN TERBAIK (Kalau ada kelas)', () => {
  const rowsByBlockLikeDetail = {
    lines: { 'ALIRAN_KELAS::0::0': 'HARI ANUGERAH', 'ALIRAN_KELAS::0::2': 'TERBAIK DALAM ALIRAN' },
    rows: [
      { id: 1, desc: 'TAHUN 1', qty: '2', kedudukanHingga: 0 },
      { id: 4, desc: 'TAHUN 4', qty: '15', kedudukanHingga: 5 },
    ],
    namaKelasBreakdown: {
      'ALIRAN_KELAS::0::TAHUN 1::main': [{ id: 10, desc: 'ADIL', qty: '1' }, { id: 11, desc: 'BESTARI', qty: '1' }],
      'ALIRAN_KELAS::0::TAHUN 4::main': [{ id: 12, desc: 'ADIL', qty: '1' }, { id: 13, desc: 'BESTARI', qty: '1' }, { id: 14, desc: 'CEKAL', qty: '1' }],
    },
  };
  const mk = (jenisPlak, posDari, posHingga) => ({
    id: `${jenisPlak}`, jenisPlak, qty: 0, categoryKey: 'ALIRAN_KELAS', blockIdx: 0,
    posDari, posHingga, detail: rowsByBlockLikeDetail,
  });

  it('ranged plak: a footer matching the Tahun\'s own KEDUDUKAN exactly claims every class\'s full QTY', () => {
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [mk('GOLD', 1, 5)] }, 'ALIRAN_KELAS', [mk('GOLD', 1, 5)]);
    // TAHUN 4 (KEDUDUKAN 1-5) exactly matches GOLD's own 1-5 -> all 3
    // classes' QTY 1 each = 3 rows, every one landing at PERTAMA (see
    // distributeQtyOverPositions(1, 5)'s remainder-to-earliest rule).
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r[2] === 'PERTAMA' && r[4] === 'TAHUN 4 ADIL')).toHaveLength(1);
    expect(rows.filter((r) => r[4] === 'TAHUN 4 CEKAL')).toHaveLength(1);
    expect(rows.every((r) => r[1] === '' && r[3] === 'TERBAIK DALAM ALIRAN')).toBe(true);
  });

  it('a footer whose range does NOT exactly match the Tahun\'s own KEDUDUKAN claims nothing from it, even if the ranges numerically overlap', () => {
    // GOLD's 1-3 overlaps TAHUN 4's own 1-5 in raw position numbers, but
    // isn't an exact match — confirmed against a real order that this must
    // NOT be treated as "the first 3 places of TAHUN 4" (that would
    // double-count once a second, exactly-matching footer also claims
    // TAHUN 4's classes in full).
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [mk('GOLD', 1, 3)] }, 'ALIRAN_KELAS', [mk('GOLD', 1, 3)]);
    expect(rows).toHaveLength(0);
  });

  it('two Tahuns with different KEDUDUKAN ranges, each claimed by its own exactly-matching footer, never double-count each other', () => {
    // Mirrors a real order: TAHUN 4 (1st-5th) uses one Jenis Plak, TAHUN 5
    // (1st-3rd) uses a different one — NOT a split of one shared range.
    const detail = {
      ...rowsByBlockLikeDetail,
      rows: [...rowsByBlockLikeDetail.rows, { id: 5, desc: 'TAHUN 5', qty: '3', kedudukanHingga: 3 }],
      namaKelasBreakdown: {
        ...rowsByBlockLikeDetail.namaKelasBreakdown,
        'ALIRAN_KELAS::0::TAHUN 5::main': [{ id: 15, desc: 'DINAMIK', qty: '2' }],
      },
    };
    const item = (jenisPlak, posDari, posHingga) => ({
      id: jenisPlak, jenisPlak, qty: 0, categoryKey: 'ALIRAN_KELAS', blockIdx: 0, posDari, posHingga, detail,
    });
    const { rows: goldRows } = buildCsvRows({ schoolLanguage: 'SK', items: [item('GOLD', 1, 5)] }, 'ALIRAN_KELAS', [item('GOLD', 1, 5)]);
    const { rows: silverRows } = buildCsvRows({ schoolLanguage: 'SK', items: [item('SILVER', 1, 3)] }, 'ALIRAN_KELAS', [item('SILVER', 1, 3)]);
    // GOLD (1-5) matches TAHUN 4 only -> its 3 classes (QTY 1 each) = 3,
    // NOT also picking up TAHUN 5's DINAMIK even though 1-3 ⊂ 1-5.
    expect(goldRows.filter((r) => r[4]?.startsWith('TAHUN 4 '))).toHaveLength(3);
    expect(goldRows.filter((r) => r[4]?.startsWith('TAHUN 5 '))).toHaveLength(0);
    // SILVER (1-3) matches TAHUN 5 only -> DINAMIK's QTY 2, none of TAHUN 4's.
    expect(silverRows.filter((r) => r[4] === 'TAHUN 5 DINAMIK')).toHaveLength(2);
    expect(silverRows.filter((r) => r[4]?.startsWith('TAHUN 4 '))).toHaveLength(0);
  });

  it('flat plak (no range): one row per (flat Tahun, class), blank position', () => {
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [mk('FLAT', null, null)] }, 'ALIRAN_KELAS', [mk('FLAT', null, null)]);
    // TAHUN 1 (flat): 2 classes → 2 rows
    expect(rows).toEqual([
      ['HARI ANUGERAH', '', '', 'TERBAIK DALAM ALIRAN', 'TAHUN 1 ADIL', 'FLAT', 'ALIRAN TERBAIK (Kalau ada kelas)'],
      ['HARI ANUGERAH', '', '', 'TERBAIK DALAM ALIRAN', 'TAHUN 1 BESTARI', 'FLAT', 'ALIRAN TERBAIK (Kalau ada kelas)'],
    ]);
  });

  it('the "TEMPAT " prefix applies here too, when line 3 CONTOH calls for it', () => {
    const withTempat = (jenisPlak, posDari, posHingga) => ({
      id: jenisPlak, jenisPlak, qty: 0, categoryKey: 'ALIRAN_KELAS', blockIdx: 0,
      posDari, posHingga,
      detail: { ...rowsByBlockLikeDetail, lines: { ...rowsByBlockLikeDetail.lines, 'ALIRAN_KELAS::0::3': 'TEMPAT PERTAMA' } },
    });
    const item = withTempat('GOLD', 1, 5);
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'ALIRAN_KELAS', [item]);
    expect(rows.filter((r) => r[2] === 'TEMPAT PERTAMA' && r[4] === 'TAHUN 4 ADIL')).toHaveLength(1);
    expect(rows.some((r) => r[2] === 'PERTAMA')).toBe(false);
  });
});

describe('buildCsvRows — dynamicMatrix with a pre-written roster column (event_line_2)', () => {
  // A KLAS_MATRIX item as aiImportMap builds it for a "prebuilt" roster:
  // one column per recipient, carrying eline2, and one blank subject row.
  const item = {
    id: 'r1', jenisPlak: 'OTHER - roster plak', qty: 2, categoryKey: 'KLAS_MATRIX', blockIdx: 0,
    detail: {
      lines: {
        'KLAS_MATRIX::0::0': 'SMK X', 'KLAS_MATRIX::0::0b': 'HEM 2024',
        'KLAS_MATRIX::0::1': 'SESI 2024/2025',
        'KLAS_MATRIX::0::2': 'ANUGERAH KEPIMPINAN MURID CEMERLANG',
      },
      rows: [{ id: 's0', desc: '' }],
      columns: [
        { id: 'c0', tahunFrom: '', tahunTo: '', namaKelas: 'KESHVINI A/P MUGAN', eline2: 'KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH' },
        { id: 'c1', tahunFrom: '', tahunTo: '', namaKelas: 'LIEW YONG SHIN', eline2: 'SETIAUSAHA\nLEMBAGA PENGAWAS SEKOLAH' },
      ],
      matrix: { 'KLAS_MATRIX::0::s0::c0': '1', 'KLAS_MATRIX::0::s0::c1': '1' },
    },
  };
  const order = { id: 'ORD-R', items: [item], schoolLanguage: 'SK' };

  it('emits the recipient in event_line_1 and jawatan+unit in event_line_2', () => {
    const { rows } = buildCsvRows(order, 'KLAS_MATRIX', [item]);
    // The `year` column is retired — always blank (the year rides on the
    // two-line TAJUK BESAR now).
    expect(rows).toEqual([
      ['SMK X\nHEM 2024', '', 'ANUGERAH KEPIMPINAN MURID CEMERLANG', 'KESHVINI A/P MUGAN', 'KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH', 'OTHER - roster plak', 'Mata Pelajaran / Klas (Matrix)'],
      ['SMK X\nHEM 2024', '', 'ANUGERAH KEPIMPINAN MURID CEMERLANG', 'LIEW YONG SHIN', 'SETIAUSAHA\nLEMBAGA PENGAWAS SEKOLAH', 'OTHER - roster plak', 'Mata Pelajaran / Klas (Matrix)'],
    ]);
  });

  it('leaves event_line_2 blank for a column with no eline2 (every catalog-native order)', () => {
    const plain = { ...item, detail: { ...item.detail, columns: item.detail.columns.map((c) => ({ ...c, eline2: '' })) } };
    const { rows } = buildCsvRows({ ...order, items: [plain] }, 'KLAS_MATRIX', [plain]);
    expect(rows.every((r) => r[4] === '')).toBe(true);
  });

  it('a combined TOKOH section (posFromKelas): position = the honour name (Nama Kelas), event_line_1 blank, no Tahun split', () => {
    const tokoh = {
      id: 't', jenisPlak: 'M1902B', categoryKey: 'KLAS_MATRIX', blockIdx: 0,
      detail: {
        lines: { 'KLAS_MATRIX::0::0': 'MAJLIS X', 'KLAS_MATRIX::0::2': 'TOKOH MURID', 'KLAS_MATRIX::0::posFromKelas': '1' },
        rows: [{ id: 'r0', desc: 'KUANTITI' }],
        columns: [
          { id: 'c0', tahunFrom: '', tahunTo: '', namaKelas: 'TOKOH MURID' },
          { id: 'c1', tahunFrom: '3', tahunTo: '6', namaKelas: 'TOKOH NILAM' },
        ],
        matrix: { 'KLAS_MATRIX::0::r0::c0': '1', 'KLAS_MATRIX::0::r0::c1': '2' },
      },
    };
    const { rows } = buildCsvRows({ id: 'O', items: [tokoh], schoolLanguage: 'SK' }, 'KLAS_MATRIX', [tokoh]);
    expect(rows).toEqual([
      ['MAJLIS X', '', 'TOKOH MURID', '', '', 'M1902B', 'Mata Pelajaran / Klas (Matrix)'],
      ['MAJLIS X', '', 'TOKOH NILAM', '', '', 'M1902B', 'Mata Pelajaran / Klas (Matrix)'],
      ['MAJLIS X', '', 'TOKOH NILAM', '', '', 'M1902B', 'Mata Pelajaran / Klas (Matrix)'],
    ]);
  });
});

describe('validateExport', () => {
  const catalog = [{ code: 'CPH', children: [{ code: 'A', price: 7.5 }, { code: 'B', price: 7.5 }] }];
  const goodItem = {
    id: 'i1', jenisPlak: 'CPH / A', qty: 2, categoryKey: 'TOKOH', blockIdx: 0,
    detail: { lines: { 'TOKOH::0::0': 'TITLE', 'TOKOH::0::2': 'X' }, rows: [{ id: 1, desc: 'X', qty: 2 }] },
  };
  const order = { id: 'ORD-1', items: [goodItem], schoolLanguage: 'SK' };
  const csvOf = (items) => buildCsvRows(order, 'TOKOH', items);

  it('passes a clean selection', () => {
    const res = validateExport(order, [goodItem], catalog, csvOf([goodItem]));
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
  });

  it('blocks when an item has no Reference Sample data', () => {
    const bad = { id: 'x', jenisPlak: 'CPH / A', qty: 1, categoryKey: 'TOKOH', blockIdx: 0 };
    const items = [goodItem, bad];
    const res = validateExport(order, items, catalog, buildCsvRows(order, 'TOKOH', items));
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no Reference Sample data/i);
  });

  it('blocks when an item has no Jenis Plak', () => {
    const bad = { ...goodItem, id: 'x', jenisPlak: '' };
    const items = [bad];
    const res = validateExport(order, items, catalog, buildCsvRows(order, 'TOKOH', items));
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no Jenis Plak/i);
  });

  it('blocks when a Jenis Plak is not in the catalog (but allows OTHER - custom)', () => {
    const unknown = { ...goodItem, id: 'x', jenisPlak: 'SM-99999 / GOLD' };
    const r1 = validateExport(order, [unknown], catalog, buildCsvRows(order, 'TOKOH', [unknown]));
    expect(r1.ok).toBe(false);
    expect(r1.errors.join(' ')).toMatch(/not found in the catalog/i);

    const custom = { ...goodItem, id: 'y', jenisPlak: 'OTHER - special gold thing' };
    const r2 = validateExport(order, [custom], catalog, buildCsvRows(order, 'TOKOH', [custom]));
    expect(r2.ok).toBe(true);
  });

  it('does not flag unknown codes when the catalog is empty (not yet loaded)', () => {
    const item = { ...goodItem, jenisPlak: 'ANYTHING / X' };
    const res = validateExport(order, [item], [], buildCsvRows(order, 'TOKOH', [item]));
    expect(res.errors.join(' ')).not.toMatch(/not found in the catalog/i);
  });

  it('warns (without blocking) on a blank event header', () => {
    const noTitle = {
      ...goodItem, id: 'nt',
      detail: { lines: { 'TOKOH::0::0': '', 'TOKOH::0::2': 'X' }, rows: [{ id: 1, desc: 'X', qty: 1 }] },
    };
    const res = validateExport(order, [noTitle], catalog, buildCsvRows(order, 'TOKOH', [noTitle]));
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/no event header/i);
  });
});

describe('buildCategoryCsvFilename', () => {
  it('uses the invoice id and strips Windows-reserved characters', () => {
    const name = buildCategoryCsvFilename({ invoiceId: 'INV/2026:90', id: 'ORD-1' }, 'A / B');
    expect(name).toBe('(INV-2026-90) - A - B.csv');
  });
  it('falls back to the order id when there is no invoice id', () => {
    expect(buildCategoryCsvFilename({ id: 'ORD-2026-097' }, 'X')).toBe('(ORD-2026-097) - X.csv');
  });
  it("uses a Jenis Plak's own invoiceGroups entry when one is assigned (0070)", () => {
    const order = {
      id: 'ORD-1', invoiceId: 'INV-100',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263'] }],
    };
    expect(buildCategoryCsvFilename(order, 'PKC 263', 'PKC 263')).toBe('(INV-200) - PKC 263.csv');
    // A Jenis Plak never listed in any group still falls back to the
    // order's own (default) invoice id.
    expect(buildCategoryCsvFilename(order, 'PKF 266', 'PKF 266')).toBe('(INV-100) - PKF 266.csv');
  });
});

describe('getInvoiceIdForJenisPlak', () => {
  it("returns the matching group's invoice id for a listed Jenis Plak", () => {
    const order = { id: 'ORD-1', invoiceId: 'INV-100', invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263', 'PKF 266'] }] };
    expect(getInvoiceIdForJenisPlak(order, 'PKC 263')).toBe('INV-200');
    expect(getInvoiceIdForJenisPlak(order, 'PKF 266')).toBe('INV-200');
  });
  it("falls back to the order's own invoiceId for an unlisted Jenis Plak", () => {
    const order = { id: 'ORD-1', invoiceId: 'INV-100', invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263'] }] };
    expect(getInvoiceIdForJenisPlak(order, 'PKF 266')).toBe('INV-100');
  });
  it('falls back to the order id when there is no invoiceId at all', () => {
    expect(getInvoiceIdForJenisPlak({ id: 'ORD-2026-097' }, 'PKC 263')).toBe('ORD-2026-097');
  });
  it("falls back to the order's invoiceId when no jenisPlak is passed", () => {
    const order = { id: 'ORD-1', invoiceId: 'INV-100', invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263'] }] };
    expect(getInvoiceIdForJenisPlak(order)).toBe('INV-100');
  });
});
