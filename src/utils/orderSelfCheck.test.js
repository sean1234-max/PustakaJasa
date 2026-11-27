import { describe, it, expect } from 'vitest';
import { joinedWordIssues, repeatedPlaqueIssues, replacePhrase, selfCheckIssues } from './orderSelfCheck';

const DICT = ['MATA', 'PELAJARAN', 'REKA', 'BENTUK', 'PRASEKOLAH', 'SEKOLAH', 'TERBAIK', 'TAHAP', 'TAHUN'];
const line = (text, blockKey = 'UMUM::0', target = { lineKey: text }) => ({ text, blockKey, target });

describe('joinedWordIssues', () => {
  it('asks about a word written joined where both halves are known words', () => {
    const [issue] = joinedWordIssues([line('ANUGERAH TERBAIK MATAPELAJARAN'), line('MATAPELAJARAN TERBAIK', 'DYN::1')], DICT);
    expect(issue).toMatchObject({ kind: 'join', word: 'MATAPELAJARAN', kk: 'MATA PELAJARAN', blockKeys: ['UMUM::0', 'DYN::1'] });
    expect(issue.targets).toHaveLength(2);
  });

  it('asks about two words where the joined word is the known one', () => {
    expect(joinedWordIssues([line('MAJLIS APRESIASI PRA SEKOLAH 2026')], DICT)).toMatchObject([{ word: 'PRA SEKOLAH', kk: 'PRASEKOLAH' }]);
  });

  it('leaves names and correctly written words alone', () => {
    expect(joinedWordIssues([line('NURHUMAIRA BINTI ALI'), line('MATA PELAJARAN TERBAIK'), line('REKA BENTUK')], DICT)).toEqual([]);
  });

  it('replaces a phrase across a line break', () => {
    expect(replacePhrase('ANUGERAH\nMATAPELAJARAN', 'MATAPELAJARAN', 'MATA PELAJARAN')).toBe('ANUGERAH\nMATA PELAJARAN');
    expect(replacePhrase('MURID PRA\nSEKOLAH', 'PRA SEKOLAH', 'PRASEKOLAH')).toBe('MURID PRASEKOLAH');
  });
});

const plaque = (red, black = []) => ({ header: 'MAJLIS ANUGERAH 2026', red, black });
const row = (rowNo, p, jenisPlak = 'PK 262 / A', blockKey = 'UMUM::0') => ({ blockKey, rowId: 1000 + rowNo, rowNo, jenisPlak, plaque: p });

describe('repeatedPlaqueIssues', () => {
  it('asks when one level is on two rows and names the missing one', () => {
    const [issue] = repeatedPlaqueIssues([
      row(1, plaque('ANUGERAH LONJAKAN AKADEMIK', ['TAHAP 2'])),
      row(2, plaque('ANUGERAH LONJAKAN AKADEMIK', ['TAHAP 2'])),
    ]);
    expect(issue).toMatchObject({ kind: 'same', rowNos: [1, 2], count: 2, level: { from: 'TAHAP 2', to: 'TAHAP 1', rowId: 1002 } });
  });

  it('lists the missing levels when more than one could be meant, and writes them as the sheet does', () => {
    const p = (lv) => plaque('MURID TERBAIK ALIRAN', [`TAHUN ${lv}`]);
    const [issue] = repeatedPlaqueIssues([row(1, p('SATU')), row(2, p('SATU')), row(3, p('DUA')), row(4, p('EMPAT'))]);
    expect(issue.level).toMatchObject({ from: 'TAHUN SATU', to: null, missing: ['TAHUN TIGA', 'TAHUN LIMA', 'TAHUN ENAM'] });
  });

  it('asks about the same plaque twice without a level, but not across Jenis Plak or sheets', () => {
    const p = plaque('TOKOH KANAK-KANAK LELAKI');
    expect(repeatedPlaqueIssues([row(1, p), row(2, p)])).toMatchObject([{ rowNos: [1, 2], level: null }]);
    expect(repeatedPlaqueIssues([row(1, p, 'MP399 / GOLD'), row(2, p, 'MP399 / SILVER')])).toEqual([]);
    expect(repeatedPlaqueIssues([row(1, p), row(2, p, 'PK 262 / A', 'UMUM::1')])).toEqual([]);
  });

  it('is quiet when every level is there once', () => {
    expect(repeatedPlaqueIssues([1, 2].map((n) => row(n, plaque('TOKOH NILAM', [`TAHAP ${n}`]))))).toEqual([]);
  });
});

describe('selfCheckIssues', () => {
  // one cart item per row, the plaque its l2 field engraves
  const item = (id, l2, blockIdx = 0) => ({ categoryKey: 'UMUM', blockIdx, jenisPlak: 'PK 262 / A', detail: { rows: [{ id, l2 }] } });
  const plaquesOf = (its) => its.map((it) => ({ header: '', red: 'ANUGERAH LONJAKAN AKADEMIK', black: [it.detail.rows[0].l2], count: 1, sheet: 'UMUM' }));
  const rowsByBlock = { 'UMUM::0': [{ id: 1 }, { id: 2 }, { id: 3 }] };
  const lines = [
    { text: 'TAHAP 2', blockKey: 'UMUM::0', target: { rowsKey: 'UMUM::0', rowId: 1, field: 'l2' } },
    { text: 'TAHAP 2', blockKey: 'UMUM::0', target: { rowsKey: 'UMUM::0', rowId: 2, field: 'l2' } },
    { text: 'MATAPELAJARAN', blockKey: 'UMUM::0', target: { rowsKey: 'UMUM::0', rowId: 3, field: 'l2' } },
  ];

  it('puts the level fix on the later row and draws the plaque each question is about', () => {
    const issues = selfCheckIssues({ items: [item(1, 'TAHAP 2'), item(2, 'TAHAP 2'), item(3, 'MATAPELAJARAN')], lines, rowsByBlock, plaquesOf, dictionary: DICT });
    const same = issues.find((i) => i.kind === 'same');
    expect(same).toMatchObject({ rowNos: [1, 2], fixFrom: 'TAHAP 2', fixTo: 'TAHAP 1', targets: [{ rowId: 2, field: 'l2' }] });
    const join = issues.find((i) => i.kind === 'join');
    expect(join).toMatchObject({ word: 'MATAPELAJARAN', fixTo: 'MATA PELAJARAN', count: 1 });
    expect(join.plaque.black).toEqual(['MATAPELAJARAN']);
  });
});

describe('repeatedPlaqueIssues, one question per sheet', () => {
  it('asks once about every plaque of a sheet that is on more than one row', () => {
    const p = (cls) => ({ header: '', red: 'ANUGERAH PENGUASAAN TERBAIK', black: [cls] });
    const rows = ['1 LILY', '1 LILY', '1 TULIP', '1 TULIP'].map((cls, i) => ({ blockKey: 'UMUM::0', rowId: i, rowNo: i + 1, jenisPlak: 'PK 262', plaque: p(cls) }));
    const issues = repeatedPlaqueIssues(rows);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ count: 4, groups: [{ rowNos: [1, 2] }, { rowNos: [3, 4] }] });
    expect(issues[0].word).toMatch(/_AND_1_MORE$/);
  });
});

describe('edge cases from review', () => {
  it('does not take PRA-SEKOLAH for two words apart', () => {
    expect(joinedWordIssues([line('MURID PRA-SEKOLAH')], DICT)).toEqual([]);
  });

  it('does not take a range for a level', () => {
    const p = { header: '', red: 'PENDIDIKAN SENI VISUAL', black: ['TAHUN 1-6'] };
    const rows = [1, 2].map((n) => ({ blockKey: 'UMUM::0', rowId: n, rowNo: n, jenisPlak: 'PKC 263', plaque: p }));
    expect(repeatedPlaqueIssues(rows)).toMatchObject([{ level: null }]);
  });
});
