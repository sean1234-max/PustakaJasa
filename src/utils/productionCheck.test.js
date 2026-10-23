import { describe, it, expect } from 'vitest';
import { plaqueProblems, checkPlaqueWording, checkPlaqueCounts, checkAiReport, a3Files } from './productionCheck';
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

describe('checkAiReport', () => {
  it('flags a file not made, a plaque count, text that changed, and a line broken where the CSV has none', () => {
    const csvRows = [
      row({ position: 'ANUGERAH KHAS NILAM', jenis_plak: 'PKC 263' }),
      row({ position: 'TOKOH MURID', jenis_plak: 'PKC 263' }),
      row({ position: 'X', jenis_plak: 'VB / C / RED' }),
    ];
    const report = {
      files: [{ codes: 'PKC 263', file: 'E CUT 5 - OUTPUT.ai', state: 'saved', rows: 2, reason: '' }, { codes: 'VB / C / RED', file: '', state: 'skipped', rows: 1, reason: 'no matching .ai template' }],
      counts: { 'PKC 263': 1 },
      plaques: [
        { code: 'PKC 263', field: 'position', csv: ['ANUGERAH KHAS NILAM'], laid: ['ANUGERAH KHAS', 'NILAM'] },
        { code: 'PKC 263', field: 'event_header', csv: ['MAJLIS ANUGERAH 2026'], laid: ['MAJLIS ANUGERAH'] },
        { code: 'PKC 263', field: 'event_line_1', csv: ['TAHUN 6'], laid: ['TAHUN 6'] },
        { code: 'PKC 263', field: 'event_line_1', csv: ['MUHAMMAD AQIL BIN MOHD RAZALI'], laid: ['MUHAMMAD AQIL', 'BIN MOHD RAZALI'] },
      ],
    };
    expect(checkAiReport(report, csvRows).map((i) => i.text)).toEqual([
      'No AI file made for VB / C / RED — no matching .ai template (1 plaque(s))',
      'PKC 263: the CSV has 2 plaque(s) but the AI file has 1',
      'position broken onto 2 lines: "ANUGERAH KHAS / NILAM"',
      'event_header: "MAJLIS ANUGERAH 2026" came out as "MAJLIS ANUGERAH"',
    ]);
  });

  it('plaques on the A3 count as made (2026-10-23)', () => {
    const csvRows = [row({ position: 'JOHAN', jenis_plak: 'YK - 628' }), row({ position: 'NAIB JOHAN', jenis_plak: 'YK - 628' })];
    const report = {
      files: [{ codes: 'YK - 628', file: 'A3 - DWI-1 - OUTPUT.ai', state: 'a3', rows: 2, reason: 'new A3' }],
      counts: { 'YK - 628': 2 },
      plaques: [],
    };
    expect(checkAiReport(report, csvRows)).toEqual([]);
    expect(a3Files(report)).toEqual([{ file: 'A3 - DWI-1 - OUTPUT.ai', codes: 'YK - 628', count: 2 }]);
  });
});
