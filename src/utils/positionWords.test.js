import { describe, it, expect } from 'vitest';
import { fileSaysTempat, withTempat } from './positionWords';

describe('TEMPAT before a bare position word (Sean, 2026-10-20)', () => {
  it('finds TEMPAT + an ordinal anywhere in the file', () => {
    expect(fileSaysTempat('RINGKASAN PLAQ  Tempat Pertama RM 12  Tempat Kedua RM 11')).toBe(true);
    expect(fileSaysTempat('TEMPAT KE-4')).toBe(true);
    expect(fileSaysTempat('PERTAMA  KEDUA  TEMPAT LETAK KERETA')).toBe(false);
  });
  it('adds TEMPAT only to a line that is just the ordinal', () => {
    expect(['PERTAMA', 'Kedua', ' KETIGA ', 'TEMPAT PERTAMA', 'KEDUDUKAN PERTAMA', '1 IBNU SINA'].map(withTempat))
      .toEqual(['TEMPAT PERTAMA', 'Tempat Kedua', 'TEMPAT KETIGA', 'TEMPAT PERTAMA', 'KEDUDUKAN PERTAMA', '1 IBNU SINA']);
  });
});

describe('TAHUN as a number (Sean, 2026-10-20)', () => {
  it('turns TAHUN SATU … ENAM into TAHUN 1 … 6, inside a line too', async () => {
    const { tahunDigits } = await import('./positionWords');
    expect(['TAHUN SATU', 'Tahun dua', 'TAHUN LIMA IBNU SINA', 'TAHUN 3', 'SATU', 'TAHUN SATU MALAYSIA'].map(tahunDigits))
      .toEqual(['TAHUN 1', 'Tahun 2', 'TAHUN 5 IBNU SINA', 'TAHUN 3', 'SATU', 'TAHUN 1 MALAYSIA']);
  });
});
