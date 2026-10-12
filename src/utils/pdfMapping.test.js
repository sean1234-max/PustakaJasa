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
    item('2 MAWAR – 5', 70, 400), item('2 MELUR – 6', 250, 400), item('9 KELAS x', 400, 400),
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
      '2 MAWAR – 5', '2 MELUR – 6', '9 KELAS x',
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

  it('points out a list item in a used row and column that the AI skipped', () => {
    const r = structuredClone(reading);
    r.groups[0].labels[0][1] = ['p1s5|1 MAWAR|3|p1s5', 'p1s6|1 MELUR|4|p1s6', 'p1s13|2 MAWAR|5|p1s13'];
    r.groups[0].total = null;
    const { notes } = applyPdfReading(ir, r);
    const skipped = notes.find((n) => /skipped/.test(n));
    // "9 KELAS x" is beside the list, not in its columns.
    expect(skipped).toContain('skipped 1 item(s)');
    expect(skipped).toContain('"2 MELUR – 6"');
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

// Made-up "sample + table" page: one sample label, a TAHUN column, a class
// list, a printed range and a subject printed over two lines.
const tablePages = [{
  page: 1, width: 600, height: 800, items: [
    item('ANUGERAH CONTOH 2026', 150, 100), // p1s1
    item('MATA PELAJARAN TERBAIK', 150, 115), // p1s2
    item('1 MAWAR', 180, 130), // p1s3
    item('PENDIDIKAN JASMANI &', 60, 160), item('1 – 3', 260, 160), item('MAWAR', 350, 160), // p1s4-6
    item('KESIHATAN', 60, 172), item('MELUR', 350, 172), item('6', 450, 172), // p1s7-9
    item('SEJARAH', 60, 190), item('MAWAR', 350, 190), item('6', 450, 190), // p1s10-12
    item('NILAM TERBAIK', 150, 250), item('TAHUN 1', 150, 265), // p1s13-14
    item('1', 260, 280), item('2', 300, 280), item('2', 260, 295), item('3', 300, 295), // p1s15-18
  ],
}];

describe('applyPdfReading — ranges, pieces and two-line items', () => {
  const ir = buildPdfIr(tablePages);
  const group = (labels, total = null) => ({ name: 'X', code: null, total, each: null, tajuk: ['p1s1'], labels, confidence: 'high', note: null });

  it('expands a printed range and joins it with the class into one engraved line', () => {
    const r = { groups: [group([[['p1s2'], ['p1s4+p1s7'], ['p1s5#1-3'], ['&', 'p1s6', 'p1s8']]], { ref: 'p1s9', value: 6 })], questions: [] };
    const { categorized, notes } = applyPdfReading(ir, r);
    const [sec] = Object.values(categorized)[0];
    expect(sec.classes.map((c) => c.eline2)).toEqual(['1 MAWAR', '1 MELUR', '2 MAWAR', '2 MELUR', '3 MAWAR', '3 MELUR']);
    expect(sec.classes[0].namaKelas).toBe('PENDIDIKAN JASMANI & KESIHATAN');
    expect(notes.some((n) => /says .* in total|1 plaque per item|for every combination|skipped/.test(n))).toBe(false);
  });

  it('refuses a range that is not printed in the segment', () => {
    const r = { groups: [group([[['p1s2'], ['p1s10'], ['p1s5#1-6']]])], questions: [] };
    expect(applyPdfReading(ir, r).bad).toBe(1);
  });

  it('refuses a "+" item whose second part is not below the first', () => {
    const r = { groups: [group([[['p1s2'], ['p1s7+p1s4']]])], questions: [] };
    expect(applyPdfReading(ir, r).bad).toBe(1);
  });

  it('reads the years from the table cells with their counts', () => {
    const r = { groups: [group([[['p1s13'], ['p1s14|TAHUN'], ['&', 'p1s15||2|p1s17', 'p1s16||3|p1s18']]])], questions: [] };
    const [sec] = Object.values(applyPdfReading(ir, r).categorized)[0];
    expect(sec.classes.map((c) => [c.namaKelas, c.subjects[0].qty])).toEqual([['TAHUN 1', 2], ['TAHUN 2', 3]]);
  });

  it('warns when a printed count is multiplied by another list', () => {
    const r = { groups: [group([[['p1s2'], ['p1s10||6|p1s12'], ['p1s6', 'p1s8']]])], questions: [] };
    const { notes } = applyPdfReading(ir, r);
    expect(notes.some((n) => /a count printed in the PDF was used for every combination of another list \(12 plaques/.test(n))).toBe(true);
  });
});
