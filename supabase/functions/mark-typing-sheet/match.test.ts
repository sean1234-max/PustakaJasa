import { describe, it, expect } from 'vitest';
import { findMarkedRow, findRows, markerName, monthTag, sheetQty } from './match.ts';

const rows = [
  { row: 742, school: 'Sk seri kelana-add on', qty: 80, mark: '' },
  { row: 745, school: 'Sk seri kelana-pss', qty: 58, mark: '' },
  { row: 746, school: 'sk puchong jaya 2', qty: 4, mark: '' },
  { row: 748, school: 'Sk seri kelana-sticker', qty: 56, mark: '' },
  { row: 749, school: 'sk puchong jaya 2', qty: 4, mark: '' },
  { row: 756, school: 'Sk SUBANG JAYA', qty: '60', mark: '' },
  { row: 758, school: 'SK TAMAN PELANGI  SEMENYIH', qty: 127, mark: '' },
];

describe('findRows', () => {
  it('finds the row by school (case, spaces) and QTY', () => {
    expect(findRows(rows, 'SK TAMAN PELANGI SEMENYIH', 127)).toEqual([758]);
    expect(findRows(rows, 'SK Subang Jaya', 60)).toEqual([756]);
  });
  it('the sheet name may say more than the school', () => {
    expect(findRows(rows, 'SK SERI KELANA', 58)).toEqual([745]);
  });
  it('QTY must be the same', () => {
    expect(findRows(rows, 'SK TAMAN PELANGI SEMENYIH', 131)).toEqual([]);
  });
  it('gives every candidate — two rows means ask the salesman', () => {
    expect(findRows(rows, 'SK PUCHONG JAYA 2', 4)).toEqual([746, 749]);
  });
  it('skips rows already marked', () => {
    const marked = rows.map((r) => (r.row === 746 ? { ...r, mark: 'SITI (NOV)' } : r));
    expect(findRows(marked, 'SK PUCHONG JAYA 2', 4)).toEqual([749]);
  });
  it('an empty school never matches', () => {
    expect(findRows(rows, '  ', 4)).toEqual([]);
  });
});

describe('findMarkedRow', () => {
  const marked = rows.map((r) => (r.row === 758 ? { ...r, mark: 'SEAN (NOV)' } : r));
  it('the remembered row', () => {
    expect(findMarkedRow(marked, 'SK TAMAN PELANGI SEMENYIH', 127, 'SEAN (NOV)', 758)).toBe(758);
  });
  it('the row moved: found by its mark', () => {
    expect(findMarkedRow(marked, 'SK TAMAN PELANGI SEMENYIH', 127, 'SEAN (NOV)', 700)).toBe(758);
  });
  it('someone changed the mark: left alone', () => {
    expect(findMarkedRow(marked, 'SK TAMAN PELANGI SEMENYIH', 127, 'SITI (NOV)', 758)).toBeNull();
  });
});

describe('sheetQty / markerName / monthTag', () => {
  it('leaves selempang out', () => {
    expect(sheetQty([{ jenisPlak: 'PKC 263', qty: 100 }, { jenisPlak: 'MEDAL', qty: '27' }, { jenisPlak: 'SELEMPANG', qty: 4 }])).toBe(127);
  });
  it('names', () => {
    expect(markerName('Sean@pjsb.com')).toBe('SEAN');
    expect(markerName('production@pjsb.com')).toBe('SITI');
    expect(markerName('kesin@pjsb.com')).toBe('KESIN');
  });
  it('month in Malaysia', () => {
    expect(monthTag(new Date('2026-11-06T03:00:00Z'))).toBe('NOV');
    expect(monthTag(new Date('2026-11-30T17:00:00Z'))).toBe('DEC'); // 1 Dec, 1am in KL
  });
});
