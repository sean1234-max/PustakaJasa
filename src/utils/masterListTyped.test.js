import { describe, it, expect } from 'vitest';
import { findTypedRow } from '../../supabase/functions/fill-google-form/masterList.ts';

// a Sheets date serial for a day (days from 1899-12-30)
const serial = (iso) => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const row = (school, qty, typed = '', day = '2026-11-16') => [serial(day), '', '', '', 'MAGGIE', school, 'SALES', qty, typed];

describe('findTypedRow (Done Typing → MASTER LIST column I)', () => {
  it('finds the website row of the school with that QTY', () => {
    const rows = [row('SK LAIN', 192), row('SK KANCHONG DARAT (W) - kurikulum', 192)];
    expect(findTypedRow(rows, 'SK KANCHONG DARAT', 192, NOW)).toEqual({ row: 3, school: 'SK KANCHONG DARAT (W) - kurikulum', qty: 192 });
  });

  it('skips a row already typed, so a split invoice with the same QTY takes the next one', () => {
    const rows = [row('SK KANCHONG DARAT', 50, 'IKIN (NOV)'), row('SK KANCHONG DARAT', 50)];
    expect(findTypedRow(rows, 'SEKOLAH KEBANGSAAN KANCHONG DARAT', 50, NOW).row).toBe(3);
  });

  it('takes the earliest of two untyped rows', () => {
    const rows = [row('SK KANCHONG DARAT', 50), row('SK KANCHONG DARAT', 50)];
    expect(findTypedRow(rows, 'SK KANCHONG DARAT', 50, NOW).row).toBe(2);
  });

  it('finds nothing for another QTY, another school or a row older than 120 days', () => {
    expect(findTypedRow([row('SK KANCHONG DARAT', 51)], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
    expect(findTypedRow([row('SK BUKIT RAYA', 50)], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
    expect(findTypedRow([row('SK KANCHONG DARAT', 50, '', '2026-06-01')], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
  });
});
