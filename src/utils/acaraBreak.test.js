import { describe, it, expect } from 'vitest';
import { breakAcaraLine } from './acaraBreak';
import { buildCsvRows } from './exportCsv';
import { customMatrixLabelKey, matrixCellKey } from '../data/catalog';

describe('breakAcaraLine', () => {
  it('breaks after PBD', () => {
    expect(breakAcaraLine('ANUGERAH PBD MATA PELAJARAN TERBAIK')).toBe('ANUGERAH PBD\nMATA PELAJARAN TERBAIK');
    expect(breakAcaraLine('  Anugerah  PBD Kecemerlangan ')).toBe('Anugerah  PBD\nKecemerlangan');
  });
  it('breaks before TERBAIK for ANUGERAH MATA PELAJARAN TERBAIK', () => {
    expect(breakAcaraLine('ANUGERAH MATA PELAJARAN TERBAIK')).toBe('ANUGERAH MATA PELAJARAN\nTERBAIK');
  });
  it('leaves everything else alone, including text that already has a line break', () => {
    expect(breakAcaraLine('ANUGERAH PBD')).toBe('ANUGERAH PBD');
    expect(breakAcaraLine('ANUGERAH KEHADIRAN TERBAIK')).toBe('ANUGERAH KEHADIRAN TERBAIK');
    expect(breakAcaraLine('ANUGERAH PBD\nMATA PELAJARAN TERBAIK')).toBe('ANUGERAH PBD\nMATA PELAJARAN TERBAIK');
    expect(breakAcaraLine('')).toBe('');
    expect(breakAcaraLine(undefined)).toBe('');
  });
});

describe('CSV export applies the ACARA two-line split', () => {
  it('MP THP position column carries the forced line break', () => {
    const item = {
      id: 'm', jenisPlak: 'DECO LIGHT', qty: 1, categoryKey: 'MP1', blockIdx: 0,
      detail: {
        lines: { 'MP1::0::0': 'H', 'MP1::0::2': 'ANUGERAH PBD MATA PELAJARAN TERBAIK' },
        matrix: { [customMatrixLabelKey('MP1', 1)]: 'BM', [matrixCellKey('MP1', 'custom-1', 'TAHUN 1')]: '1' },
      },
    };
    const { rows } = buildCsvRows({ schoolLanguage: 'SK', items: [item] }, 'MP1', [item]);
    expect(rows[0][2]).toBe('ANUGERAH PBD\nMATA PELAJARAN TERBAIK\nBM');
  });
});
