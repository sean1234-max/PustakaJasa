import { describe, it, expect } from 'vitest';
import { buildPdfIr, renderPdfIrText } from './pdfIr';
import { applyPdfReading, applyPictureHeading, applyPlaquePictures, splitSchoolLines } from './pdfMapping';

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

describe('applyPdfReading — name lists', () => {
  const ir = buildPdfIr([{ page: 1, width: 600, height: 800, items: [
    item('MAJLIS CONTOH 2026', 150, 100), item('NAMA CONTOH', 150, 115), item('ANUGERAH BINTANG CERIA', 150, 130), // p1s1-3
    item('1) BINTANG CERIA', 60, 200), item('MURID SATU', 300, 200), // p1s4-5
    item('MURID DUA', 300, 215), // p1s6
    item('2) WIRA PAGI', 60, 230), item('MURID TIGA', 300, 230), // p1s7-8
  ] }]);
  const group = (labels) => ({ name: 'X', code: null, total: null, each: null, tajuk: ['p1s1'], labels, names: true, confidence: 'high', note: null });

  it('puts each award on one tab with the names, engraved name first', () => {
    const r = { groups: [group([
      [['p1s5', 'p1s6'], ['p1s3|ANUGERAH'], ['&', 'p1s4|BINTANG CERIA']],
      [['p1s8'], ['p1s3|ANUGERAH'], ['&', 'p1s7|WIRA PAGI']],
    ])], questions: [] };
    const { categorized } = applyPdfReading(ir, r);
    const tabs = Object.values(categorized).map(([sec]) => [sec.lines[2], sec.nameFirst, sec.classes.map((c) => c.namaKelas)]);
    expect(tabs).toEqual([
      ['ANUGERAH BINTANG CERIA', true, ['MURID SATU', 'MURID DUA']],
      ['ANUGERAH WIRA PAGI', true, ['MURID TIGA']],
    ]);
  });
});


describe('buildPdfIr word pieces', () => {
  it('joins items that touch into one word and keeps spaced ones apart', () => {
    const at = (str, x, w) => ({ str, x, y: 100, w, size: 12 });
    const ir = buildPdfIr([{ page: 1, width: 600, height: 800, items: [
      at('ANUGERAH SAID', 260.8, 82.4), at('I', 343.3, 3), at('NA ABU BAKAR', 346.3, 74.4),
      at('=', 494.6, 6), at('9', 503.3, 6.1), at('9', 509.4, 6.1),
      at('1', 550, 6.1), at('UM', 559, 15),
    ] }]);
    expect(ir.segments.map((s) => s.text)).toEqual(['ANUGERAH SAIDINA ABU BAKAR', '=', '99', '1', 'UM']);
  });
});

describe('odd label check', () => {
  it('flags one label whose line differs by one word from its siblings', () => {
    const at = (str, x, y) => ({ str, x, y, w: str.length * 5, size: 10 });
    const ir = buildPdfIr([{ page: 1, width: 600, height: 800, items: [
      at('PKC 263', 300, 50),
      at('ANUGERAH MAHATMA GANDHI', 300, 100), at('TAHUN 1', 300, 115),
      at('SAHAJA MAHATMA GANDHI', 300, 200), at('TAHUN 2', 300, 215),
      at('ANUGERAH MAHATMA GANDHI', 300, 300), at('TAHUN 3', 300, 315),
    ] }]);
    const id = (y) => ir.segments.find((s) => s.y === y).id;
    const label = (y) => [[id(y)], [id(y + 15)]];
    const res = applyPdfReading(ir, { groups: [{
      name: 'G', code: { ref: id(50), text: 'PKC 263' }, total: null, each: null, tajuk: [], names: false, confidence: 'high', note: null,
      labels: [label(100), label(200), label(300)],
    }] });
    expect(res.notes.some((n) => n.includes('one label reads "SAHAJA MAHATMA GANDHI" where the others read "ANUGERAH MAHATMA GANDHI"'))).toBe(true);
    expect(res.count).toBe(3);
  });
});

describe('applyPictureHeading', () => {
  it('takes the picture lines where they agree with the text heading', () => {
    const cat = {
      a: [{ lines: { 0: 'MAJLIS APRESIASI AKADEMIK', 2: 'ANUGERAH IBNU SINA' } }],
      b: [{ lines: { 0: 'HARI SUKAN', 2: 'JOHAN' } }],
      c: [{ lines: { 2: 'ANUGERAH CHOLAR' } }],
    };
    const notes = applyPictureHeading(cat, { lines: ['SEKOLAH KEBANGSAAN TAMAN MELAWATI 2', 'MAJLIS APRESIASI AKADEMIK', '(SESI 2026)'], confidence: 'high' });
    expect(cat.a[0].lines[0]).toBe('SEKOLAH KEBANGSAAN TAMAN MELAWATI 2\nMAJLIS APRESIASI AKADEMIK\n(SESI 2026)');
    expect(cat.b[0].lines[0]).toBe('HARI SUKAN');
    expect(cat.c[0].lines[0]).toBe('SEKOLAH KEBANGSAAN TAMAN MELAWATI 2\nMAJLIS APRESIASI AKADEMIK\n(SESI 2026)');
    expect(notes).toEqual([`TAJUK BESAR: "SEKOLAH KEBANGSAAN TAMAN MELAWATI 2", "(SESI 2026)" were read from a picture of the sample label (not the PDF's text) — please check them against the PDF.`]);
  });

  it('ignores an unsure reading', () => {
    const cat = { a: [{ lines: { 0: 'MAJLIS' } }] };
    expect(applyPictureHeading(cat, { lines: ['SK X', 'MAJLIS'], confidence: 'low' })).toEqual([]);
    expect(cat.a[0].lines[0]).toBe('MAJLIS');
  });
});

describe('splitSchoolLines', () => {
  it('puts each school on its own line', () => {
    expect(splitSchoolLines([
      'SEKOLAH KEBANGSAAN TAMAN MELAWATI 2SEKOLAH KLUSTER', 'KECEMERLANGAN', 'MAJLIS APRESIASI AKADEMIK 2026',
    ])).toEqual(['SEKOLAH KEBANGSAAN TAMAN MELAWATI 2', 'SEKOLAH KLUSTER KECEMERLANGAN', 'MAJLIS APRESIASI AKADEMIK 2026']);
    expect(splitSchoolLines(['SEKOLAH KEBANGSAAN TAMAN MELAWATI 2 SEKOLAH KLUSTER KECEMERLANGAN']))
      .toEqual(['SEKOLAH KEBANGSAAN TAMAN MELAWATI 2', 'SEKOLAH KLUSTER KECEMERLANGAN']);
  });

  it('leaves lines that are already right', () => {
    const ok = ['SEKOLAH KEBANGSAAN TAMAN MELAWATI 2', 'SEKOLAH KLUSTER KECEMERLANGAN', 'MAJLIS APRESIASI AKADEMIK', '(SESI 2026)'];
    expect(splitSchoolLines(ok)).toEqual(ok);
    expect(splitSchoolLines(['SEKOLAH KEBANGSAAN', 'TAMAN MELAWATI 2'])).toEqual(['SEKOLAH KEBANGSAAN', 'TAMAN MELAWATI 2']);
  });
});

describe('applyPlaquePictures', () => {
  const sec = (award, code) => ({ lines: { 0: 'MAJLIS APRESIASI AKADEMIK', 2: award }, jenisPlak: code, classes: [] });
  const photo = (code, design, award, confidence = 'high') => ({ page: 9, code, design, award, confidence });

  it('adds the design a photo shows, and a code to a batch with none', () => {
    const cat = {
      a: [sec('ANUGERAH TOKOH SAIDINA ALI', '0011A')],
      b: [sec('ANUGERAH TOKOH SAIDINA ALI', 'SA4')],
      c: [sec('ANUGERAH IBNU SINA', 'PKC 263')],
      d: [sec('ANUGERAH TOKOH SAIDINA ALI', '')],
      e: [sec('ANUGERAH MAHATMA GANDHI', '')],
    };
    const notes = applyPlaquePictures(cat, [
      photo('0011A', 'DESIGN A', 'ANUGERAH TOKOH SAIDINA ALI'),
      photo('CODE SA4', 'DESIGN A', null),
      photo('PKC 263', null, 'ANUGERAH IBNU SINA'),
    ]);
    expect(['a', 'b', 'c', 'd', 'e'].map((k) => cat[k][0].jenisPlak)).toEqual(['0011A DESIGN A', 'SA4 DESIGN A', 'PKC 263', '0011A DESIGN A', '']);
    expect(notes).toHaveLength(2); // a and d share one note
  });

  it('leaves the plaque alone when photos disagree or are unsure', () => {
    const cat = { a: [sec('ANUGERAH X', '0011A')], b: [sec('ANUGERAH Y', '')] };
    applyPlaquePictures(cat, [
      photo('0011A', 'DESIGN A', null), photo('0011A', 'DESIGN B', null),
      photo('SA4', 'DESIGN A', 'ANUGERAH Y', 'low'),
    ]);
    expect([cat.a[0].jenisPlak, cat.b[0].jenisPlak]).toEqual(['0011A', '']);
  });
});

describe('applyPdfReading — TEMPAT before PERTAMA (Sean, 2026-10-20)', () => {
  const ir = buildPdfIr([{ page: 1, width: 600, height: 800, items: [
    item('IHTIFAL 2026', 150, 100), item('KEDUDUKAN TERBAIK', 150, 115), item('1 IBNU SINA', 150, 130), // p1s1-3
    item('TEMPAT PERTAMA', 150, 145), item('KEDUA', 150, 160), // p1s4-5
    item('PERTAMA', 60, 300), item('Tempat Pertama RM 12', 60, 400), // p1s6-7
  ] }]);
  const reading = (ordinals) => ({ groups: [{ name: 'X', code: null, total: null, each: null, tajuk: ['p1s1'], labels: [[['p1s2'], ['p1s3'], ordinals]], confidence: 'high', note: null }], questions: [] });

  it('adds TEMPAT when the batch itself says "Tempat Pertama"', () => {
    const { categorized, notes } = applyPdfReading(ir, reading(['p1s4|PERTAMA', 'p1s5']));
    const text = JSON.stringify(categorized);
    expect(text).toContain('TEMPAT PERTAMA');
    expect(text).toContain('TEMPAT KEDUA');
    expect(notes.join('\n')).toContain('TEMPAT was added');
  });
  it('keeps PERTAMA when "Tempat" is only elsewhere in the file (a price list)', () => {
    const { categorized, notes } = applyPdfReading(ir, reading(['p1s6', 'p1s5']));
    const text = JSON.stringify(categorized);
    expect(text).toContain('"PERTAMA"');
    expect(text).not.toContain('TEMPAT');
    expect(notes.join('\n')).not.toContain('TEMPAT');
  });
});

describe('applyPdfReading — TAHUN SATU as TAHUN 1 (Sean, 2026-10-20)', () => {
  it('writes the year heading word as a number', () => {
    const ir = buildPdfIr([{ page: 1, width: 600, height: 800, items: [
      item('IHTIFAL 2026', 150, 100), item('MATA PELAJARAN TERBAIK', 150, 115), // p1s1-2
      item('TAHUN', 300, 180), item('SATU', 250, 190), item('DUA', 350, 190), item('ADAB', 60, 200), // p1s3-6
    ] }]);
    const r = { groups: [{ name: 'X', code: null, total: null, each: null, tajuk: ['p1s1'], labels: [[['p1s2'], ['p1s6'], ['p1s3'], ['&', 'p1s4', 'p1s5']]], confidence: 'high', note: null }], questions: [] };
    const text = JSON.stringify(applyPdfReading(ir, r).categorized);
    expect(text).toContain('TAHUN 1');
    expect(text).toContain('TAHUN 2');
    expect(text).not.toContain('SATU');
  });
});

describe('applyPdfReading — a list of awards is one tab (Sean, 2026-10-21)', () => {
  // A Word table: each award over the same event lines, 1 plaque each.
  const awardPages = [{
    page: 1, width: 600, height: 800, items: [
      item('PKC 246', 70, 80),
      item('CEMERLANG BAHASA MELAYU', 70, 100), item('TAHAP 1', 70, 115),
      item('CEMERLANG MATEMATIK', 70, 130), item('TAHAP 1', 70, 145),
      item('CEMERLANG PENDIDIKAN MORAL', 70, 160),
      item('HARI KECEMERLANGAN SAHSIAH DIRI MURID', 300, 200),
      item('SK BUKIT RIMAU', 300, 215), item('2026', 300, 230),
    ],
  }];
  const ir = buildPdfIr(awardPages);
  const tail = [['p1s7'], ['p1s8'], ['p1s9']];
  const awardReading = {
    groups: [{
      name: 'ANUGERAH UNIT KURIKULUM', code: { ref: 'p1s1', text: 'PKC 246' }, total: null, tajuk: [], each: null,
      labels: [[['p1s2'], ['p1s3'], ...tail], [['p1s4'], ['p1s5'], ...tail], [['p1s6'], ...tail]],
      confidence: 'high', note: null,
    }],
    questions: [],
  };

  it('puts every award on one ORDER LAIN-LAIN-style tab, a row each', () => {
    const { categorized } = applyPdfReading(ir, awardReading);
    expect(Object.keys(categorized)).toHaveLength(1);
    const [section] = Object.values(categorized)[0];
    expect(section.sourceSheet).toBe('ANUGERAH UNIT KURIKULUM');
    expect(section.isUmumList).toBe(true);
    expect(section.umumRows.map((r) => [r.qty, r.jenisPlak])).toEqual([[1, 'PKC 246'], [1, 'PKC 246'], [1, 'PKC 246']]);
  });

  it('keeps a tab per award when only two awards are listed', () => {
    const two = { ...awardReading, groups: [{ ...awardReading.groups[0], labels: awardReading.groups[0].labels.slice(0, 2) }] };
    expect(Object.keys(applyPdfReading(ir, two).categorized)).toHaveLength(2);
  });
});
