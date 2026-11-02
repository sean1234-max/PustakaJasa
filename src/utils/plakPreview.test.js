import { describe, it, expect } from 'vitest';
import { withoutColour, fileForCode, templateNameFor, pickTemplate, rankColor, lineOrderFor, layoutPlaque } from './plakPreview';

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
    expect(pickTemplate({ T_H_PC: {} }, 'TC_PC')).toBeNull();
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

  it('breaks ANUGERAH titles and a long TAJUK BESAR like SEAN.jsx', () => {
    const row = { event_header: 'MAJLIS ANUGERAH KECEMERLANGAN SK TAMAN SEROJA 2026', position: 'ANUGERAH MURID CEMERLANG' };
    const { fields } = layoutPlaque(row, tpl, { measure });
    expect(fields[0].lines).toEqual(['MAJLIS ANUGERAH KECEMERLANGAN SK TAMAN', 'SEROJA 2026']);
    expect(fields[1].lines).toEqual(['ANUGERAH', 'MURID CEMERLANG']);
  });
});
