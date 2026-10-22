import { describe, it, expect } from 'vitest';
import { plaqueProblems, checkPlaqueWording, checkPlaqueCounts } from './productionCheck';
import { compareWords } from './sourceCheck';
import { CSV_COLUMNS } from './exportCsv';

const row = (fields) => CSV_COLUMNS.map((c) => fields[c] || '');

describe('plaqueProblems', () => {
  it('flags a line twice, a year on two lines, a word typed twice', () => {
    expect(plaqueProblems(['MAJLIS ANUGERAH 2026', 'TOKOH NILAM', 'TAHUN 2026'])).toEqual(['the year 2026 is on 2 lines']);
    expect(plaqueProblems(['MAJLIS 2026', 'TAHUN 2026', 'TAHUN 2026'])).toEqual(['"TAHUN 2026" appears twice on the plaque', 'the year 2026 is on 3 lines']);
    expect(plaqueProblems(['ANUGERAH ANUGERAH KHAS'])).toEqual(['"ANUGERAH ANUGERAH" — a word typed twice']);
    expect(plaqueProblems(['MAJLIS ANUGERAH 2026', 'TOKOH NILAM', 'TAHUN 6'])).toEqual([]);
  });
});

describe('checkPlaqueWording', () => {
  it('groups the same problem across plaques, with an example', () => {
    const rows = [1, 2].map(() => row({ event_header: 'MAJLIS 2026', position: 'TOKOH', event_line_1: 'TAHUN 2026', jenis_plak: 'PKC 263' }));
    expect(checkPlaqueWording(rows)).toEqual([{ kind: 'wording', text: 'the year 2026 is on 2 lines', count: 2, sample: 'PKC 263: MAJLIS 2026 / TOKOH / TAHUN 2026' }]);
  });
});

describe('checkPlaqueCounts', () => {
  it('flags a Jenis Plak whose AI file would get a different number of plaques than ordered', () => {
    const groups = [
      { jenisPlak: 'PKC 263', items: [{ qty: '3' }, { qty: '2' }], csvData: { rows: [1, 2, 3, 4], reservedCount: 0 } },
      { jenisPlak: 'VB / C / RED', items: [{ qty: '2' }], csvData: { rows: [1], reservedCount: 1 } },
    ];
    expect(checkPlaqueCounts(groups).map((c) => c.text)).toEqual(['PKC 263: the order has 5 plaque(s) but the AI file would get 4']);
  });
});

describe('compareWords', () => {
  it('lists words lost from the file and words added on the plaques, ignoring form and order words', () => {
    const r = compareWords({
      fileTexts: ['NAMA | CODE | JUMLAH\nMAJLIS ANUGERAH 2026\nANUGERAH AKADEMIK\n1 BESTARI\n1 BIJAK\nSK TAMAN GEMBIRA'],
      templateText: 'TOLONG ISI DI SINI',
      plaqueText: 'MAJLIS ANUGERAH 2026\nANUGERAH AKADEMIK\nTAHUN 1',
      orderText: 'SK TAMAN GEMBIRA',
    });
    expect(r).toEqual({ missing: ['BESTARI', 'BIJAK'], extra: ['TAHUN'] });
  });
});
