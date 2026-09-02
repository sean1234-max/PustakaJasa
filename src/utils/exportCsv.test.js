import { describe, it, expect } from 'vitest';
import {
  CSV_COLUMNS, rowsToCsv, buildCsvRows, validateExport, buildCategoryCsvFilename,
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

describe('buildCsvRows — dynamicMatrix with a pre-written roster column (event_line_2)', () => {
  // A KLAS_MATRIX item as aiImportMap builds it for a "prebuilt" roster:
  // one column per recipient, carrying eline2, and one blank subject row.
  const item = {
    id: 'r1', jenisPlak: 'OTHER - roster plak', qty: 2, categoryKey: 'KLAS_MATRIX', blockIdx: 0,
    detail: {
      lines: {
        'KLAS_MATRIX::0::0': 'SMK X\nHEM 2024', 'KLAS_MATRIX::0::1': 'SESI 2024/2025',
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
