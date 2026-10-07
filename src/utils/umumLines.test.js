import { describe, it, expect } from 'vitest';
import { umumSlotFields, umumRedSlots, UMUM_NO_RED } from './umumLines';

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

describe('umumRedSlots — which CONTOH line prints red', () => {
  it('the MERAH line', () => {
    expect(umumRedSlots(lines('SK X', 'TAHUN 1', 'ALI'), '2')).toEqual(['2']);
  });

  it('nothing ticked: only a line found by a position keyword', () => {
    expect(umumRedSlots(lines('SK X', 'JOHAN TAHUN 4', 'ALI'))).toEqual(['1']);
    expect(umumRedSlots(lines('SK X', 'ANUGERAH', 'TOKOH MURID'))).toEqual(['1', '2']);
  });

  it('a guessed position (no keyword) is black', () => {
    expect(umumRedSlots(lines('SK SEREMBAN JAYA', 'TAHUN 1'))).toEqual([]);
    expect(umumRedSlots(lines('KARNIVAL', 'PENGAKAP', 'ROVER'))).toEqual([]);
  });

  it('unticked: black, though the line is still the position', () => {
    expect(umumRedSlots(lines('SK X', 'JOHAN TAHUN 4'), UMUM_NO_RED)).toEqual([]);
    expect(umumSlotFields(lines('SK X', 'JOHAN TAHUN 4'), UMUM_NO_RED)).toEqual({ 0: 'event_header', 1: 'position' });
  });
});

describe('MERAH line + a MAJLIS line further down (ORD-0026)', () => {
  it('the MAJLIS line is still the TAJUK BESAR; the rest fill the event lines', () => {
    const contoh = { 0: 'ANUGERAH TOKOH MURID (LELAKI)', 1: 'PRA IBNU KHALDUN', 2: 'MAJLIS APRESIASI PRASEKOLAH 2026' };
    expect(umumSlotFields(contoh, '0')).toEqual({ 0: 'position', 1: 'event_line_1', 2: 'event_header' });
  });

  it('no header keyword: ① stays the TAJUK BESAR unless ① is the red line', () => {
    expect(umumSlotFields({ 0: 'PRA IBNU', 1: 'TOKOH MURID', 2: 'NAMA' }, '1')).toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
    expect(umumSlotFields({ 0: 'TOKOH MURID', 1: 'PRA IBNU', 2: 'NAMA' }, '0')).toEqual({ 0: 'position', 1: 'event_line_1', 2: 'event_line_2' });
  });
});
