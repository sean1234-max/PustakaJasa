import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.ts', () => ({ db: {} }));
const { missPath, expiredDays } = await import('./ruleMiss.ts');

describe('missPath', () => {
  it('a day folder, then the id and a storage-safe name', () => {
    expect(missPath('2026-11-25', 'ab12cd34', 'Kertas Kerja (ANUGERAH) 2026.docx')).toBe('2026-11-25/ab12cd34-Kertas_Kerja_ANUGERAH_2026.docx');
  });

  it('a name with nothing safe left still gets one', () => {
    expect(missPath('2026-11-25', 'ab12cd34', '奖状.pdf')).toBe('2026-11-25/ab12cd34-.pdf');
    expect(missPath('2026-11-25', 'ab12cd34', '')).toBe('2026-11-25/ab12cd34-file');
  });
});

describe('expiredDays', () => {
  it('only day folders older than 60 days', () => {
    expect(expiredDays(['2026-09-25', '2026-09-26', '2026-11-25', 'notes.txt'], '2026-11-25')).toEqual(['2026-09-25']);
  });
});
