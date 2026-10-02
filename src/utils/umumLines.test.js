import { describe, it, expect } from 'vitest';
import { umumSlotFields } from './umumLines';

const lines = (...texts) => Object.fromEntries(texts.map((t, i) => [`${i}`, t]).filter(([, t]) => t));

describe('umumSlotFields — which CONTOH line goes on which plaque field', () => {
  it('MERAH line = position, ① = TAJUK BESAR, the rest top to bottom = line 1 / line 2', () => {
    expect(umumSlotFields(lines('SK TAMAN SEGAR\nKARNIVAL 2026', 'PENGAKAP', 'JOHAN TAHUN 4'), '2'))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
    expect(umumSlotFields(lines('MAJLIS X', 'ANUGERAH', 'ALI', '6 BESTARI'), '1'))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1', 3: 'event_line_2' });
  });

  it('no MERAH: keywords — the sheet\'s own CONTOH example', () => {
    expect(umumSlotFields(lines('SK TAMAN SEGAR\nKARNIVAL KOKURIKULUM 2026', 'PENGAKAP', 'JOHAN TAHUN 4')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
  });

  it('a line with both kinds of keyword is the TAJUK BESAR', () => {
    expect(umumSlotFields(lines('MAJLIS ANUGERAH KECEMERLANGAN 2026', 'TOKOH MURID', 'ALI BIN ABU')))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
  });

  it('touching lines of the same kind join (two-line title, two-line position)', () => {
    expect(umumSlotFields(lines('SK TAMAN SEGAR', 'HARI ANUGERAH 2026', 'ANUGERAH', 'TOKOH MURID')))
      .toEqual({ 0: 'event_header', 1: 'event_header', 2: 'position', 3: 'position' });
  });

  it('no position keyword: the first leftover line becomes the position (every template needs one)', () => {
    expect(umumSlotFields(lines('SK TAMAN SEGAR 2026', 'PENGAKAP', 'ROVER')))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
  });

  it('no title keyword: ① is the TAJUK BESAR anyway (Sean, 2026-10-02)', () => {
    expect(umumSlotFields(lines('KARNIVAL KOKURIKULUM', 'JOHAN TAHUN 4', 'ALI BIN ABU')))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
    // ...unless ① is itself the position line
    expect(umumSlotFields(lines('TOKOH MURID', 'ALI BIN ABU')))
      .toEqual({ 0: 'position', 1: 'event_line_1' });
  });

  it('no keyword at all: ① ② ③ ④ = TAJUK / position / line 1 / line 2', () => {
    expect(umumSlotFields(lines('KARNIVAL', 'PENGAKAP', 'ROVER', 'KUMPULAN A')))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1', 3: 'event_line_2' });
  });

  it('Chinese keywords', () => {
    expect(umumSlotFields(lines('新山宽柔小学\n2026年颁奖典礼', '冠军', '陈小明')))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
  });

  it('empty slots are skipped', () => {
    expect(umumSlotFields({ 0: 'MAJLIS X', 2: 'JOHAN' })).toEqual({ 0: 'event_header', 2: 'position' });
  });
});
