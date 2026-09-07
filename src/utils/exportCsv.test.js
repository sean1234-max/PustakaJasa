import { describe, it, expect } from 'vitest';
import {
  CSV_COLUMNS, rowsToCsv, buildCsvRows, validateExport, buildCategoryCsvFilename, isReservedName,
} from './exportCsv';

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
    expect(rows).toEqual([['HARI ANUGERAH 2026', '', 'TOKOH MURID', 'AHMAD BIN ALI', '']]);
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
    expect(csv.rows).toEqual([['HARI ANUGERAH 2026', '', 'TOKOH MURID', 'SITI', '']]);
    expect(csv.reservedCount).toBe(2);

    const res = validateExport(order, items, [], csv);
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /Reserved.*held for stock/.test(w))).toBe(true);
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
  const mk = (id, jenisPlak, posDari, posHingga, qty) => ({
    id, jenisPlak, qty, categoryKey: 'ALIRAN', blockIdx: 0,
    posDari, posHingga,
    detail: { lines: { 'ALIRAN::0::0': 'HARI ANUGERAH 2026', 'ALIRAN::0::2': 'ANUGERAH ALIRAN TERBAIK' }, rows: tahunRows },
  });
  const order = { id: 'ORD-A', schoolLanguage: 'SK' };

  it('derived qty (not overridden): one row per (ranked Tahun, place)', () => {
    // h25 covers places 4-10 → 7 per ranked Tahun × 3 = 21
    const h25 = mk('h', 'h25', 4, 10, 21);
    const { rows } = buildCsvRows({ ...order, items: [h25] }, 'ALIRAN', [h25]);
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r[2] === 'ANUGERAH ALIRAN TERBAIK\nKEEMPAT')).toHaveLength(3);
    expect(rows.filter((r) => r[3] === 'TAHUN 4')).toHaveLength(7);
  });

  it('overridden qty: emits exactly item.qty rows, ordinals cycle the range, Tahun blank', () => {
    // gold covers places 1-3 → derived would be 9; teacher typed 3
    const gold = mk('g', 'sm-13187(gold)', 1, 3, 3);
    const { rows } = buildCsvRows({ ...order, items: [gold] }, 'ALIRAN', [gold]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r[2])).toEqual([
      'ANUGERAH ALIRAN TERBAIK\nPERTAMA',
      'ANUGERAH ALIRAN TERBAIK\nKEDUA',
      'ANUGERAH ALIRAN TERBAIK\nKETIGA',
    ]);
    expect(rows.every((r) => r[3] === '')).toBe(true);
  });

  it('flat plak row (no range): one row per plaque of the flat Tahuns', () => {
    const flat = mk('f', 'DECO LIGHT', null, null, 15);
    const { rows } = buildCsvRows({ ...order, items: [flat] }, 'ALIRAN', [flat]);
    expect(rows).toHaveLength(15);
    expect(rows.filter((r) => r[3] === 'TAHUN 1')).toHaveLength(5);
    expect(rows.every((r) => r[2] === 'ANUGERAH ALIRAN TERBAIK')).toBe(true);
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
    expect(rows).toEqual([
      ['SMK X\nHEM 2024', 'SESI 2024/2025', 'ANUGERAH KEPIMPINAN MURID CEMERLANG', 'KESHVINI A/P MUGAN', 'KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH'],
      ['SMK X\nHEM 2024', 'SESI 2024/2025', 'ANUGERAH KEPIMPINAN MURID CEMERLANG', 'LIEW YONG SHIN', 'SETIAUSAHA\nLEMBAGA PENGAWAS SEKOLAH'],
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
      ['MAJLIS X', '', 'TOKOH MURID', '', ''],
      ['MAJLIS X', '', 'TOKOH NILAM', '', ''],
      ['MAJLIS X', '', 'TOKOH NILAM', '', ''],
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
});
