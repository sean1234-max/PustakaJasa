import { describe, it, expect } from 'vitest';
import { withoutColour, fileForCode, templateNameFor, pickTemplate, rankColor, lineOrderFor, layoutPlaque, templateFor } from './plakPreview';

const manifest = {
  mapping: [['PK 261/C', 'E CUT 6 - PLAK C (020C, stand lamp FD 251).ai'], ['YK - 628', 'E TROFI H25-1, YK 628, YK 610.ai']],
  files: [{ file: 'E CUT 6 - PLAK C (020C, stand lamp FD 251).ai' }, { file: 'E CUT 9 - STAND MEDAL BASE B.ai' },
    { file: 'E TROFI H25-1, YK 628, YK 610.ai' }, { file: 'E TROFI 13228 B.ai' }, { file: 'E TROFI SR-116 A.ai' },
    { file: 'E TROFI W038 A.ai' }],
};
const box = (t, b) => ({ box: [-70, t, 70, b], justify: 'center', color: '#000000' });
const tpl = { anchor: [167, 71], fields: { event_header: box(20, 12), position: box(10, -8), RANK_YELLOW: { ...box(10, -8), color: '#d4a017' }, event_line_1: box(-10, -18) } };
const measure = (text, size) => text.length * size * 0.5;

describe('plakPreview — the same .ai and layout group as SEAN.jsx', () => {
  it('finds the .ai by product_mapping.csv, BASE, trofi code', () => {
    expect(fileForCode('PK 261 / C', manifest)).toBe('E CUT 6 - PLAK C (020C, stand lamp FD 251).ai');
    expect(fileForCode('MP393 / GOLD / BASE B', manifest)).toBe('E CUT 9 - STAND MEDAL BASE B.ai');
    expect(fileForCode('13228 (B)', manifest)).toBe('E TROFI 13228 B.ai');
    expect(fileForCode('VB / C / RED', manifest)).toBeNull();
    // a trophy's colour isn't part of its .ai (2026-11-02)
    expect(fileForCode('SR-116 A / BLUE', manifest)).toBe('E TROFI SR-116 A.ai');
    expect(fileForCode('W038 / A / GOLD', manifest)).toBe('E TROFI W038 A.ai');
    expect(withoutColour('MP 399 / GOLD / BASE WITHOUT COVER')).toBe('MP 399 / BASE WITHOUT COVER');
    expect(withoutColour('SR-116 A / BLUE')).toBe('SR-116 A');
  });

  it('gives every hanging medal (HM…, HANGING MEDAL) the round medal file, after product_mapping.csv', () => {
    const medal = { mapping: [['HM-M-9999', 'E CUT 6 - PLAK C (020C, stand lamp FD 251).ai']],
      files: [...manifest.files, { file: 'E CUT 0 - MEDAL (SUKAN) -SALES.ai' }] };
    expect(fileForCode('HM-M-0031 / GOLD', medal)).toBe('E CUT 0 - MEDAL (SUKAN) -SALES.ai');
    expect(fileForCode('hm 7026', medal)).toBe('E CUT 0 - MEDAL (SUKAN) -SALES.ai');
    expect(fileForCode('MEDAL HANGING MEDAL', medal)).toBe('E CUT 0 - MEDAL (SUKAN) -SALES.ai');
    expect(fileForCode('HM-M-9999', medal)).toBe('E CUT 6 - PLAK C (020C, stand lamp FD 251).ai');
    expect(fileForCode('HMX 12', medal)).toBeNull();
    expect(fileForCode('HM-M-0031', manifest)).toBeNull();
  });

  it('names the layout group by the filled lines and falls back to the closest one', () => {
    expect(templateNameFor({ event_header: 'MAJLIS', position: 'JOHAN', event_line_1: 'ALI' })).toBe('T_H_PC_L1');
    expect(templateNameFor({ position: '冠军' })).toBe('TC_PC');
    expect(pickTemplate({ T_H_PC_L1: {}, T_PC_L1: {} }, 'T_PC')).toBe('T_PC_L1');
    // no TC_ group: made from the T_ twin (SEAN.jsx, 2026-11-17)
    expect(pickTemplate({ T_H_PC: {} }, 'TC_PC')).toBe('T_H_PC');
    expect(pickTemplate({ TC_PC_L1: {}, T_PC: {} }, 'TC_PC')).toBe('TC_PC_L1');
  });

  it('colours a position by a whole-line rank keyword', () => {
    expect(rankColor('JOHAN')).toBe('yellow');
    expect(rankColor('NAIB JOHAN')).toBe('grey');
    expect(rankColor('ANUGERAH JOHAN SUKAN')).toBeNull();
    // PLATINUM is yellow like EMAS (Sean, 2026-11-19)
    expect(rankColor('ANUGERAH PLATINUM')).toBe('yellow');
    expect(rankColor('PLATINUM')).toBe('yellow');
  });

  it('follows the line order from the Reference Sample', () => {
    expect(lineOrderFor({ line_order: 'position|event_header|event_line_1' })).toEqual(['position', 'event_header', 'year', 'event_line_1', 'event_line_2']);
    const row = { event_header: 'MAJLIS', position: 'JOHAN', event_line_1: 'ALI', line_order: 'position|event_header|event_line_1|event_line_2' };
    const { fields } = layoutPlaque(row, tpl, { measure });
    expect(fields.map((f) => f.field)).toEqual(['position', 'event_header', 'event_line_1']);
    expect(fields[0].color).toBe('#d4a017');
    // the stack is centred on the anchor
    const top = fields[0].baselines[0] - fields[0].size * 0.72;
    const bottom = fields[2].baselines[0];
    expect(Math.abs(top + bottom)).toBeLessThan(0.01);
  });

  it('lays a position of 3 words or fewer at 14pt, leading 15, on 1–2 lines; line 1 / line 2 4pt apart, others 8pt (Sean 2026-11-19, ORD-0457)', () => {
    const wide = { ...tpl, fields: { ...tpl.fields, position: box(10, -8), event_line_2: box(-20, -26) } };
    const row = { event_header: 'MAJLIS', position: 'TERBAIK MATA PELAJARAN', event_line_1: 'BAHASA INGGERIS', event_line_2: '1 CEMPAKA 10' };
    const { fields } = layoutPlaque(row, wide, { measure });
    const pos = fields.find((f) => f.field === 'position');
    expect(pos).toMatchObject({ size: 14, leading: 15 });
    expect(pos.lines).toHaveLength(2);
    const ink = (f) => [f.baselines[0] - f.size * 0.72, f.baselines[f.baselines.length - 1]];
    const gaps = fields.slice(1).map((f, i) => ink(f)[0] - ink(fields[i])[1]);
    [8, 8, 4].forEach((g, i) => expect(gaps[i]).toBeCloseTo(g, 5));
    expect(layoutPlaque({ event_header: 'MAJLIS', position: 'JOHAN' }, wide, { measure }).fields[1].size).toBe(14);
    // 4 words keep the usual size; a trophy keeps its own
    expect(layoutPlaque({ ...row, position: 'MURID CEMERLANG AKADEMIK TAHUN' }, wide, { measure }).fields[1].size).toBeLessThan(14);
    expect(layoutPlaque({ event_header: 'MAJLIS', position: 'JOHAN' }, wide, { measure, trofi: true }).fields[1].size).toBe(16);
  });

  it('keeps JOHAN red on a plaque with a background (no rank colours)', () => {
    const row = { event_header: 'MAJLIS', position: 'JOHAN' };
    const { fields } = layoutPlaque(row, tpl, { measure, rankColors: false });
    expect(fields.find((f) => f.field === 'position').color).toBe(tpl.fields.position.color);
  });

  it('breaks ANUGERAH titles and a long TAJUK BESAR like SEAN.jsx', () => {
    const row = { event_header: 'MAJLIS ANUGERAH KECEMERLANGAN SK TAMAN SEROJA 2026', position: 'ANUGERAH MURID CEMERLANG' };
    const { fields } = layoutPlaque(row, tpl, { measure });
    expect(fields[0].lines).toEqual(['MAJLIS ANUGERAH KECEMERLANGAN SK TAMAN', 'SEROJA 2026']);
    expect(fields[1].lines).toEqual(['ANUGERAH', 'MURID CEMERLANG']);
  });

  it('sets the TAJUK BESAR at 11pt / leading 10, a trophy keeps 12pt / 11.4 (SEAN.jsx, Sean 2026-11-25)', () => {
    const row = { event_header: 'HI TEA BKGK', position: 'JOHAN' };
    expect(layoutPlaque(row, tpl, { measure }).fields[0]).toMatchObject({ size: 11, leading: 10 });
    const trofi = layoutPlaque(row, tpl, { measure, trofi: true }).fields[0];
    expect(trofi.size).toBe(12);
    expect(trofi.leading).toBeCloseTo(9 * 12 / 9.5, 5);
  });

  it('puts ANUGERAH KHAS on line 1 and the rest on line 2 for 3–5 words, whatever breaks were typed (Sean 2026-11-25)', () => {
    const pos = (position) => layoutPlaque({ event_header: 'HI TEA', position }, tpl, { measure }).fields[1].lines;
    expect(pos('ANUGERAH\nKHAS GURU BESAR')).toEqual(['ANUGERAH KHAS', 'GURU BESAR']);
    expect(pos('ANUGERAH KHAS PENGETUA')).toEqual(['ANUGERAH KHAS', 'PENGETUA']);
    expect(pos('ANUGERAH KHAS')).toEqual(['ANUGERAH KHAS']);
    expect(pos('ANUGERAH KHAS A B C D')).toEqual(['ANUGERAH KHAS A B C D']);
  });
});

describe('plakPreview — one master template with a TEXT_AREA (SEAN.jsx 2026-11-18)', () => {
  const area = [-60, 25, 60, -25];
  const master = { anchor: [167, 71], textArea: area, fields: { ...tpl.fields, event_line_2: { ...box(-20, -26), size: 7 }, year: box(15, 12) } };
  const entry = { templates: { T_H_Y_PC_L1_L2: master } };
  const inkOf = (f) => [f.baselines[0] - f.size * 0.72, f.baselines[f.baselines.length - 1]];

  it('lays a lone line 2 out as line 1, a Chinese row on the T_ master', () => {
    const lone = templateFor(entry, { event_line_2: 'ALI BIN ABU' });
    expect(lone.row.event_line_1).toBe('ALI BIN ABU');
    expect(lone.row.event_line_2).toBe('');
    const zh = templateFor(entry, { position: '冠军', event_line_1: '陈大文', event_line_2: '三年级' });
    expect(zh.name).toBe('T_H_Y_PC_L1_L2');
    expect(zh.chineseFromT).toBe(true);
    const { fields } = layoutPlaque(zh.row, master, { measure, chineseFromT: true });
    expect(fields.find((f) => f.field === 'event_line_2').font.family).toContain('KaiTi');
  });

  it('stacks the lines 8pt apart (boxes = letters + 4pt, edge to edge), line 1 / line 2 4pt, inside TEXT_AREA, centred on the anchor', () => {
    const row = { event_header: 'MAJLIS ANUGERAH', position: 'JOHAN', event_line_1: 'ALI', event_line_2: 'TAHUN 6' };
    const { fields } = layoutPlaque(row, master, { measure });
    const inks = fields.map(inkOf);
    const gaps = inks.slice(1).map(([t], i) => t - inks[i][1]);
    [8, 8, 4].forEach((g, i) => expect(gaps[i]).toBeCloseTo(g, 5));
    expect(inks[0][0] + inks[inks.length - 1][1]).toBeCloseTo(0, 5);
    expect(inks[inks.length - 1][1] - inks[0][0]).toBeLessThanOrEqual(50.01);
  });

  it('grows a one-line plaque in Times New Roman Bold up to 24pt, a full line tried as two', () => {
    const short = layoutPlaque({ event_header: 'TAHNIAH' }, master, { measure }).fields[0];
    expect(short.font.family).toContain('Times New Roman');
    expect(short.size).toBe(24);
    expect(short.leading).toBe(25);
    const long = layoutPlaque({ event_line_1: 'MAJLIS PERPISAHAN TAHUN ENAM 2026' }, master, { measure }).fields[0];
    expect(long.lines).toHaveLength(2);
    long.lines.forEach((l) => expect(measure(l, long.size)).toBeLessThanOrEqual(120 * 0.96 + 0.01));
    // Chinese keeps its font, not one-line Times
    expect(layoutPlaque({ event_header: '毕业典礼' }, master, { measure }).fields[0].font.family).toContain('KaiTi');
  });

  it('lays a lone position out like a lone line: Times New Roman Bold, black, no rank colour (Sean 2026-11-18)', () => {
    const red = { ...master, fields: { ...master.fields, position: { ...master.fields.position, color: '#e30613' }, event_header: { ...master.fields.event_header, color: '#e30613' } } };
    const [johan] = layoutPlaque({ position: 'JOHAN' }, red, { measure }).fields;
    expect(johan.field).toBe('position');
    expect(johan.font.family).toContain('Times New Roman');
    expect(johan.color).toBe('#000000');
    expect(johan.size).toBe(24);
    expect(layoutPlaque({ event_header: 'MAJLIS PERPISAHAN' }, red, { measure }).fields[0].color).toBe('#000000');
    // with other lines the position keeps its rank colour
    const two = layoutPlaque({ event_header: 'MAJLIS', position: 'JOHAN' }, red, { measure }).fields;
    expect(two.find((f) => f.field === 'position').color).toBe('#d4a017');
    // no TEXT_AREA: Times and black too, at the template's position size
    const plain = layoutPlaque({ position: 'NAIB JOHAN' }, tpl, { measure }).fields[0];
    expect(plain.font.family).toContain('Times New Roman');
    expect(plain.color).toBe('#000000');
  });
});

describe('round medal arcs (Sean, 2026-11-25)', () => {
  // E CUT 0 DESIGN 1: event_header / year are path text — their box is the path's circle
  const arcTpl = {
    anchor: [106.3, 106.3],
    fields: {
      event_header: { box: [-41.53, 40.53, 41.53, -42.53], size: 12, color: '#000000', justify: 'center', path: true },
      year: { box: [-46.77, 44.27, 46.77, -49.62], size: 12, color: '#000000', justify: 'center', path: true },
      event_line_1: { box: [-36.97, 23.1, 36.97, 12.09], size: 10, color: '#000000', justify: 'center' },
      RANK_GREY: { box: [-37.56, -3.53, 37.56, -17.49], size: 11, color: '#c0c0c0', justify: 'center' },
    },
  };

  it('puts the TAJUK on the top arc and the YEAR on the bottom one, the rest stacked in the middle', () => {
    const row = { event_header: 'SK TEST MEDAL', year: 'KEJOHANAN OLAHRAGA 2026', position: 'NAIB JOHAN', event_line_1: 'TAHUN 6' };

    const { fields } = layoutPlaque(row, arcTpl, { measure });
    const header = fields.find((f) => f.field === 'event_header');
    const year = fields.find((f) => f.field === 'year');

    expect(header.arc).toEqual({ cx: 0, cy: 1, r: 41.53, top: true });
    expect(year.arc.top).toBe(false);
    expect(year.arc.r).toBeCloseTo(46.77);
    expect(header.lines).toEqual(['SK TEST MEDAL']);
    expect(fields.filter((f) => !f.arc).map((f) => f.field)).toEqual(['position', 'event_line_1']);
    expect(fields.find((f) => f.field === 'position').color).toBe('#c0c0c0');
  });

  it('joins a two-line TAJUK on the arc and shrinks it to fit 150° of the circle', () => {
    const long = 'SK TAMAN SRI ANDALAS\nKLANG SELANGOR';

    const header = layoutPlaque({ event_header: long }, arcTpl, { measure }).fields.find((f) => f.field === 'event_header');

    expect(header.lines).toEqual(['SK TAMAN SRI ANDALAS KLANG SELANGOR']);
    expect(measure(header.lines[0], header.size)).toBeLessThanOrEqual(41.53 * (150 * Math.PI / 180) + 0.5);
    expect(header.size).toBeLessThan(12);
  });
});
