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

  it('stacks the lines 8pt apart (boxes = letters + 4pt, edge to edge) inside TEXT_AREA, centred on the anchor', () => {
    const row = { event_header: 'MAJLIS ANUGERAH', position: 'JOHAN', event_line_1: 'ALI', event_line_2: 'TAHUN 6' };
    const { fields } = layoutPlaque(row, master, { measure });
    const inks = fields.map(inkOf);
    const gaps = inks.slice(1).map(([t], i) => t - inks[i][1]);
    gaps.forEach((g) => expect(g).toBeCloseTo(8, 5));
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
