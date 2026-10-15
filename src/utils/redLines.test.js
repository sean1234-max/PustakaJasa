import { describe, it, expect } from 'vitest';
import { resolveCategory } from '../data/catalog';
import { buildCsvRows } from './exportCsv';
import { redPickFor, redLinesProblem } from './redLines';

// ORD-0059's PPKI shape (Sean, 2026-10-15): the teacher put the event in row 2
// and the red award + class in row 3.
const P = 'PPKI::0::';
const item = (extra = {}) => ({
  id: 'p', jenisPlak: 'PKC 263', qty: 1, categoryKey: 'PPKI', blockIdx: 0,
  detail: {
    lines: { [`${P}0`]: 'SK TAMAN MELAWATI 2', [`${P}2`]: 'MAJLIS APRESIASI AKADEMIK 2026', [`${P}3`]: 'ANUGERAH IBNU SINA \nALIRAN TAHUN 1  PPKI', [`${P}hiddenLines`]: '1,2b', ...extra },
    matrix: { 'PPKI::custom-1::__label__': 'ANUGERAH IBNU SINA', 'PPKI::custom-1::PPKI': '1' },
    namaKelasBreakdown: { 'PPKI::0::PPKI::main': [{ id: 1, desc: 'ALIRAN TAHUN 1', qty: '1' }] },
  },
});
const first = (it) => buildCsvRows({ schoolLanguage: 'SK', items: [it] }, 'PPKI', [it]).rows[0];

describe('MERAH ticks (redLines)', () => {
  const cat = resolveCategory('PPKI');

  it('untouched: the sheet\'s own layout (row 2 red)', () => {
    const r = first(item());
    expect(r[2]).toBe('MAJLIS APRESIASI AKADEMIK 2026');
    expect(redPickFor(item().detail.lines, P, cat, '2').checked).toBe(true);
    expect(redPickFor(item().detail.lines, P, cat, '3').checked).toBe(false);
    expect(redPickFor(item().detail.lines, P, cat, '0')).toBeNull();
  });

  // row 3's own lines as the sheet lays them out (subject, then the class line)
  const row3 = () => { const d = first(item()); return `${d[3]}\n${d[4]}`; };

  it('row 3 ticked, row 2 not: row 3 is the red line, row 2 prints black above it', () => {
    const r = first(item({ [`${P}redLines`]: '3' }));
    expect(r[2]).toBe(row3());
    expect(r[3]).toBe('MAJLIS APRESIASI AKADEMIK 2026');
    expect(r[4]).toBe('');
    expect(r[7]).toBe('event_header|event_line_1|position|event_line_2');
    expect(r[8]).toBe('');
  });

  it('two rows ticked: the first, Alt+Enter, the second', () => {
    const r = first(item({ [`${P}redLines`]: '2,3' }));
    expect(r[2]).toBe(`MAJLIS APRESIASI AKADEMIK 2026\n${row3()}`);
    expect([r[3], r[4]]).toEqual(['', '']);
  });

  it('nothing ticked: the first row prints in the position frame, black', () => {
    const r = first(item({ [`${P}redLines`]: 'none' }));
    expect([r[2], r[3], r[8]]).toEqual(['MAJLIS APRESIASI AKADEMIK 2026', row3(), '1']);
  });

  it('ticking stores the whole list in row order', () => {
    const lines = item({ [`${P}redLines`]: '3' }).detail.lines;
    expect(redPickFor(lines, P, cat, '2').value).toBe('2,3');
    expect(redPickFor(lines, P, cat, '3').value).toBe('none');
  });

  it('more black rows than a plaque has lines for is blocked', () => {
    const aliran = resolveCategory('ALIRAN');
    const A = 'ALIRAN::0::';
    const lines = { [`${A}2`]: 'ACARA', [`${A}2b`]: 'TAHUN 1', [`${A}3`]: 'PERTAMA' };
    expect(redLinesProblem(lines, A, aliran)).toBe('');
    expect(redLinesProblem({ ...lines, [`${A}redLines`]: '3' }, A, aliran)).toBe('');
    expect(redLinesProblem({ ...lines, [`${A}redLines`]: 'none' }, A, aliran)).toBe('');
  });
});
