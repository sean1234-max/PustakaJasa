import { describe, it, expect } from 'vitest';
import { buildPdfIr, renderPdfIrText } from './pdfIr';
import { applyPdfReading } from './pdfMapping';

// Made-up page: a sample label + a class list with counts, and a grid of
// two finished labels side by side.
const item = (str, x, y, size = 10) => ({ str, x, y, w: str.length * size * 0.5, size });
const pages = [{
  page: 1, width: 600, height: 800, items: [
    item('PK 100 – 7 pcs', 70, 100),
    item('MAJLIS ANUGERAH CONTOH 2026', 150, 130),
    item('PELAJAR CEMERLANG', 170, 145),
    item('1 MAWAR', 200, 160),
    item('1 MAWAR – 3', 70, 200), item('1 MELUR – 4', 250, 200),
    item('PK 200 – 2 pcs', 70, 300),
    item('JOHAN', 90, 330), item('NAIB JOHAN', 300, 330),
    item('BAHASA', 80, 345), item('MELAYU', 125, 345), item('BAHASA MELAYU', 300, 345),
  ],
}];

const reading = {
  groups: [
    {
      name: 'PK 100', code: { ref: 'p1s1', text: 'PK 100' }, total: { ref: 'p1s1', value: 7 },
      tajuk: ['p1s2'],
      each: null,
      labels: [[['p1s3'], ['p1s5|1 MAWAR|3|p1s5', 'p1s6|1 MELUR|4|p1s6']]],
      confidence: 'high', note: null,
    },
    {
      name: 'PK 200', code: { ref: 'p1s7', text: 'PK 200' }, total: { ref: 'p1s7', value: 2 },
      tajuk: [], each: null,
      labels: [[['p1s8'], ['p1s10-p1s11']], [['p1s9'], ['p1s12']]],
      confidence: 'high', note: null,
    },
  ],
  questions: [],
};

describe('pdfIr', () => {
  it('splits side-by-side text into segments and numbers them in reading order', () => {
    const ir = buildPdfIr(pages);
    expect(ir.segments.map((s) => s.text)).toEqual([
      'PK 100 – 7 pcs', 'MAJLIS ANUGERAH CONTOH 2026', 'PELAJAR CEMERLANG', '1 MAWAR',
      '1 MAWAR – 3', '1 MELUR – 4', 'PK 200 – 2 pcs', 'JOHAN', 'NAIB JOHAN', 'BAHASA', 'MELAYU', 'BAHASA MELAYU',
    ]);
    expect(renderPdfIrText(ir)).toContain('y=200: [p1s5 x=70] 1 MAWAR – 3  [p1s6 x=250] 1 MELUR – 4');
  });
});

describe('applyPdfReading', () => {
  const ir = buildPdfIr(pages);

  it('expands a list, reads quantities from the file and checks totals', () => {
    const { categorized, notes, count } = applyPdfReading(ir, reading);
    expect(count).toBe(3);
    const pc = Object.values(categorized).find((secs) => secs[0].lines[2] === 'PELAJAR CEMERLANG')[0];
    expect(pc.lines[0]).toBe('MAJLIS ANUGERAH CONTOH 2026');
    expect(pc.jenisPlak).toBe('PK 100');
    expect(pc.classes.map((c) => [c.namaKelas, c.subjects[0].qty])).toEqual([['1 MAWAR', 3], ['1 MELUR', 4]]);
    const johan = Object.values(categorized).find((secs) => secs[0].lines[2] === 'JOHAN')[0];
    expect(johan.classes[0].namaKelas).toBe('BAHASA MELAYU');
    expect(notes.some((n) => /says .* in total/.test(n))).toBe(false);
  });

  it('drops a label whose quoted text is not in the segment', () => {
    const r = structuredClone(reading);
    r.groups[0].labels[0][1][0] = 'p1s5|1 ORKID|3|p1s5';
    const { notes } = applyPdfReading(ir, r);
    expect(notes.some((n) => /didn't match the file/.test(n))).toBe(true);
  });

  it('rejects a quantity that is not printed in the file', () => {
    const r = structuredClone(reading);
    r.groups[0].labels[0][1][0] = 'p1s5|1 MAWAR|9|p1s5';
    const { notes, bad } = applyPdfReading(ir, r);
    expect(bad).toBe(1);
    expect(notes.some((n) => /didn't match the file/.test(n))).toBe(true);
  });

  it('flags a stated total that the labels do not add up to', () => {
    const r = structuredClone(reading);
    r.groups[1].labels.pop();
    const { notes } = applyPdfReading(ir, r);
    expect(notes).toContain('"PK 200": the PDF says 2 in total, but the labels add up to 1 — please check nothing is missing or extra.');
  });

  it('assumes 1 per list item when no quantity is printed, and says so', () => {
    const r = structuredClone(reading);
    r.groups[0].labels[0][1] = ['p1s5|1 MAWAR', 'p1s6|1 MELUR'];
    const { notes } = applyPdfReading(ir, r);
    expect(notes.some((n) => /1 plaque per item was used \(2 plaques\)/.test(n))).toBe(true);
    expect(notes.some((n) => /says 7 in total, but the labels add up to 2/.test(n))).toBe(true);
  });

  it('ignores refs to segments that do not exist', () => {
    const r = structuredClone(reading);
    r.groups[1].labels[0][0] = ['p9s1'];
    const { notes } = applyPdfReading(ir, r);
    expect(notes.some((n) => /"PK 200": a label's wording didn't match/.test(n))).toBe(true);
  });

  it('points out a list item on a used row that the AI skipped', () => {
    const r = structuredClone(reading);
    r.groups[0].labels[0][1] = ['p1s5|1 MAWAR|3|p1s5', 'p1s4'];
    const { notes } = applyPdfReading(ir, r);
    expect(notes.some((n) => n.includes('skipped 1 item(s)') && n.includes('"1 MELUR – 4"'))).toBe(true);
    expect(applyPdfReading(ir, reading).notes.some((n) => /skipped/.test(n))).toBe(false);
  });

  it('reads a whole-segment option with its own count, and a per-label count', () => {
    const r = structuredClone(reading);
    r.groups[1].each = { ref: 'p1s7', value: 2 };
    r.groups[1].total = null;
    const { categorized } = applyPdfReading(ir, r);
    const johan = Object.values(categorized).find((secs) => secs[0].lines[2] === 'JOHAN')[0];
    expect(johan.classes[0].subjects[0].qty).toBe(2);
  });
});
