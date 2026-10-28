import { describe, it, expect } from 'vitest';
import { umumSlotFields, umumRedSlots, umumDefaultRedSlot, UMUM_NO_RED } from './umumLines';

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

describe('two touching MERAH lines (ORD-0076, 2026-10-28)', () => {
  const c = lines('MAJLIS APRESIASI & GRADUASI PPKI 2026', 'ANUGERAH MATA PELAJARAN ELEKTIF TERBAIK', 'PENGURUSAN DIRI', '1 PKB ALBIRUNI');
  it('both are the position, both red', () => {
    expect(umumSlotFields(c, '1,2')).toEqual({ 0: 'event_header', 1: 'position', 2: 'position', 3: 'event_line_1' });
    expect(umumRedSlots(c, '1,2')).toEqual(['1', '2']);
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

describe('umumSlotFields — year lines (Sean, 2026-10-12)', () => {
  it('"TAHUN 2026" stays its own line, not joined to the TAJUK BESAR', () => {
    expect(umumSlotFields(lines('MAJLIS APRESIASI PRASEKOLAH', 'TAHUN 2026', 'ANUGERAH MATA PELAJARAN BAHASA MELAYU TERBAIK'), '2'))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
  });

  it('a bare "2026" still joins the TAJUK BESAR', () => {
    expect(umumSlotFields(lines('MAJLIS APRESIASI PRASEKOLAH', ' 2026 ', 'ANUGERAH TERBAIK'), '2'))
      .toEqual({ 0: 'event_header', 1: 'event_header', 2: 'position' });
  });

  it('with nothing marked MERAH, a "TAHUN 2026" line is never the guessed position', () => {
    expect(umumSlotFields(lines('MAJLIS APRESIASI PRASEKOLAH', 'TAHUN 2026', 'PENGAKAP')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
    expect(umumSlotFields(lines('KARNIVAL', 'TAHUN 2026', 'PENGAKAP')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
  });

  it('every line a title and nothing MERAH (ORD-0015): ① TAJUK BESAR, then line 1 / line 2, no position', () => {
    expect(umumSlotFields(lines('MAJLIS APRESIASI PRA SEKOLAH', 'SK SERI CHERAS', '2026')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'event_line_2' });
    expect(umumSlotFields(lines('SAMBUTAN HARI LAHIR', 'PRASEKOLAH SK SERI CHERAS', '2026')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'event_line_2' });
  });

  it('a MERAH line still makes the position even when every line looks like a title', () => {
    expect(umumSlotFields(lines('MAJLIS APRESIASI PRA SEKOLAH', 'SK SERI CHERAS', '2026'), '1'))
      .toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
  });
});

describe('ANUGERAH is red by default (Sean, 2026-10-20)', () => {
  it('nothing marked MERAH: the ANUGERAH line is the red position, ahead of other keywords', () => {
    const c = lines('IHTIFAL 2026', 'KEDUDUKAN TERBAIK', '1 IBNU SINA', 'ANUGERAH SAHSIAH');
    expect(umumSlotFields(c)).toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'event_line_2', 3: 'position' });
    expect(umumRedSlots(c, '')).toEqual(['3']);
  });
  it('a MERAH pick or untick still wins, and a HARI ANUGERAH title is not red', () => {
    const c = lines('IHTIFAL 2026', 'ANUGERAH SAHSIAH', 'PERTAMA');
    expect(umumRedSlots(c, '2')).toEqual(['2']);
    expect(umumRedSlots(c, UMUM_NO_RED)).toEqual([]);
    expect(umumRedSlots(lines('HARI ANUGERAH 2026', 'JOHAN'), '')).toEqual(['1']);
  });
});

describe('a place line is red first (Sean, 2026-10-20)', () => {
  it('PERTAMA / TEMPAT KEDUA wins over ANUGERAH and other keywords', () => {
    expect(umumRedSlots(lines('IHTIFAL 2026', 'KEDUDUKAN TERBAIK', '1 IBNU SINA', 'PERTAMA'), '')).toEqual(['3']);
    expect(umumRedSlots(lines('IHTIFAL 2026', 'ANUGERAH CEMERLANG', 'TEMPAT KEDUA'), '')).toEqual(['2']);
    expect(umumSlotFields(lines('IHTIFAL 2026', 'ANUGERAH CEMERLANG', 'TEMPAT KEDUA')))
      .toEqual({ 0: 'event_header', 1: 'event_line_1', 2: 'position' });
  });
  it('no place line: ANUGERAH is red; a MERAH pick still wins', () => {
    expect(umumRedSlots(lines('IHTIFAL 2026', 'ANUGERAH SAHSIAH', 'TAHUN 1'), '')).toEqual(['1']);
    expect(umumRedSlots(lines('IHTIFAL 2026', 'ANUGERAH CEMERLANG', 'PERTAMA'), '1')).toEqual(['1']);
  });
});

describe('red by default — the same rule as the FORM ANUGERAH (Sean, 2026-10-20)', () => {
  it('an ANUGERAH line that also says SEKOLAH is the red position, not part of the title', () => {
    const c = { 0: 'MAJLIS APRESIASI HAL EHWAL MURID\n2026', 1: 'ANUGERAH\nPENGHARGAAN PENGAWAS SEKOLAH', 2: 'TAHUN 6' };
    expect(umumDefaultRedSlot(c)).toBe('1');
    expect(umumSlotFields(c, '')).toEqual({ 0: 'event_header', 1: 'position', 2: 'event_line_1' });
    expect(umumRedSlots(c, '')).toEqual(['1']);
  });

  it('KEHADIRAN / KEDUDUKAN lines are red too', () => {
    expect(umumRedSlots({ 0: 'MAJLIS ANUGERAH 2026', 1: 'KEHADIRAN PENUH', 2: 'TAHUN 6' }, '')).toEqual(['1']);
    expect(umumRedSlots({ 0: 'MAJLIS ANUGERAH 2026', 1: 'TAHUN 6', 2: 'KEDUDUKAN 1' }, '')).toEqual(['2']);
  });

  it('a place line still comes first', () => {
    expect(umumRedSlots({ 0: 'MAJLIS ANUGERAH 2026', 1: 'ANUGERAH SUKAN', 2: 'TEMPAT PERTAMA' }, '')).toEqual(['2']);
  });
});
