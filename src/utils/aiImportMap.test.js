import { describe, it, expect } from 'vitest';
import { aiResultToParsed, importLooksThin } from './aiImportMap';

const base = (over) => ({
  isOrderFile: true,
  awards: [],
  nonPlaqueItems: [],
  frontPgTotals: [],
  questions: [],
  ...over,
});

describe('importLooksThin', () => {
  it('is thin for an error, no sections, or all-zero quantities', () => {
    expect(importLooksThin({ error: 'x' })).toBe(true);
    expect(importLooksThin({ klasMatrix: { sections: [] } })).toBe(true);
    expect(importLooksThin({
      klasMatrix: { sections: [{ classes: [{ subjects: [{ name: 'A', qty: 0 }] }] }] },
    })).toBe(true);
  });

  it('is not thin when a section carries real quantity', () => {
    expect(importLooksThin({
      klasMatrix: { sections: [{ classes: [{ subjects: [{ name: 'A', qty: 3 }] }] }] },
    })).toBe(false);
  });
});

describe('aiResultToParsed', () => {
  it('rejects a non-order file', () => {
    expect(aiResultToParsed(base({ isOrderFile: false })).error).toBeTruthy();
  });

  it('maps a no-breakdown award (ANUGERAH IKON MURID / 30) to one class, blank subject', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'MAJLIS  APRESIASI KECEMERLANGAN 2025',
        year: '', awardName: 'ANUGERAH IKON MURID', jenisPlak: 'PK 020 A',
        plaques: [{ line1: '', line2: '', count: 30 }],
        statedTotal: 30, note: '',
      }],
      frontPgTotals: [{ jenisPlak: 'PK 020 A', qty: 30 }],
    }));
    expect(parsed.error).toBeUndefined();
    const [sec] = parsed.klasMatrix.sections;
    expect(sec.lines).toEqual({ '0': 'MAJLIS APRESIASI KECEMERLANGAN 2025', '2': 'ANUGERAH IKON MURID' });
    expect(sec.classes).toEqual([
      { tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: '', qty: 30 }] },
    ]);
    expect(sec.jenisPlak).toBe('PK 020 A');
    expect(sec.frontPgQty).toBe(30);
  });

  it('maps a subject-by-year award: line1 -> Tahun, line2 -> subject columns', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'MAJLIS APRESIASI KECEMERLANGAN 2025', year: '',
        awardName: 'ANUGERAH CEMERLANG MATA PELAJARAN', jenisPlak: 'CRYSTAL MEDAL (BIRU GELAP)',
        plaques: [
          { line1: 'TAHUN 4', line2: 'BAHASA MELAYU', count: 1 },
          { line1: 'TAHUN 4', line2: 'MATEMATIK', count: 1 },
          { line1: 'TAHUN 5', line2: 'BAHASA MELAYU', count: 1 },
        ],
        statedTotal: 3, note: '',
      }],
    }));
    expect(parsed.klasMatrix.sections[0].classes).toEqual([
      { tahunFrom: 'TAHUN 4', tahunTo: 'TAHUN 4', namaKelas: '', subjects: [{ name: 'BAHASA MELAYU', qty: 1 }, { name: 'MATEMATIK', qty: 1 }] },
      { tahunFrom: 'TAHUN 5', tahunTo: 'TAHUN 5', namaKelas: '', subjects: [{ name: 'BAHASA MELAYU', qty: 1 }] },
    ]);
  });

  it('keeps a non-"TAHUN N" qualifier ("1 AMANAH", "PRASEKOLAH") whole as Nama Kelas', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'E', year: '', awardName: 'ANUGERAH CEMERLANG PBD', jenisPlak: 'PKC 253',
        plaques: [
          { line1: '1 AMANAH', line2: '', count: 5 },
          { line1: 'PRASEKOLAH', line2: '', count: 4 },
        ],
        statedTotal: null, note: '',
      }],
    }));
    expect(parsed.klasMatrix.sections[0].classes).toEqual([
      { tahunFrom: '', tahunTo: '', namaKelas: '1 AMANAH', subjects: [{ name: '', qty: 5 }] },
      { tahunFrom: '', tahunTo: '', namaKelas: 'PRASEKOLAH', subjects: [{ name: '', qty: 4 }] },
    ]);
  });

  it('maps a "prebuilt" named-recipient roster: name -> event_line_1, role+unit -> event_line_2', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'SMK BANDAR BARU SERI PETALING, KUALA LUMPUR\nANUGERAH KECEMERLANGAN HAL EHWAL MURID (HEM)',
        year: 'SESI 2024/2025', awardName: 'ANUGERAH KEPIMPINAN MURID CEMERLANG', jenisPlak: '',
        layout: 'prebuilt',
        plaques: [
          { line1: 'KESHVINI A/P MUGAN', line2: 'KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH', count: 1 },
          { line1: 'LIEW YONG SHIN', line2: 'PENOLONG KETUA PENGAWAS II\nLEMBAGA PENGAWAS SEKOLAH', count: 1 },
        ],
        statedTotal: 26, note: '',
      }],
    }));
    const [sec] = parsed.klasMatrix.sections;
    expect(sec.lines).toEqual({
      '0': 'SMK BANDAR BARU SERI PETALING, KUALA LUMPUR\nANUGERAH KECEMERLANGAN HAL EHWAL MURID (HEM)',
      '1': 'SESI 2024/2025',
      '2': 'ANUGERAH KEPIMPINAN MURID CEMERLANG',
    });
    expect(sec.classes).toEqual([
      { tahunFrom: '', tahunTo: '', namaKelas: 'KESHVINI A/P MUGAN', eline2: 'KETUA PENGAWAS\nLEMBAGA PENGAWAS SEKOLAH', subjects: [{ name: '', qty: 1 }] },
      { tahunFrom: '', tahunTo: '', namaKelas: 'LIEW YONG SHIN', eline2: 'PENOLONG KETUA PENGAWAS II\nLEMBAGA PENGAWAS SEKOLAH', subjects: [{ name: '', qty: 1 }] },
    ]);
  });

  it('joins a "senarai hadiah" pre-written label (non-Tahun line1 + line2) into one position block, no duplicate year', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'MAJLIS ANUGERAH KECEMERLANGAN PPKI SKDC 2025', year: '2025/2026',
        awardName: 'PBD TERBAIK', jenisPlak: '19540 B',
        plaques: [{ line1: 'KELAS PROGRAM PENDIDIKAN KHAS INTEGRASI SK DESA CEMPAKA', line2: 'TAHUN 2025/2026', count: 30 }],
        statedTotal: 30, note: '',
      }],
    }));
    const [sec] = parsed.klasMatrix.sections;
    expect(sec.lines).toEqual({ '0': 'MAJLIS ANUGERAH KECEMERLANGAN PPKI SKDC 2025', '2': 'PBD TERBAIK' });
    expect(sec.classes).toEqual([
      { tahunFrom: '', tahunTo: '', namaKelas: '', subjects: [{ name: 'KELAS PROGRAM PENDIDIKAN KHAS INTEGRASI SK DESA CEMPAKA\nTAHUN 2025/2026', qty: 30 }] },
    ]);
  });

  it('carries award notes and non-plaque items into remarkNotes', () => {
    const parsed = aiResultToParsed(base({
      awards: [{
        eventHeader: 'E', year: '', awardName: 'A', jenisPlak: 'X',
        plaques: [{ line1: '', line2: '', count: 2 }], statedTotal: null,
        note: 'PPKI ada perubahan wording',
      }],
      nonPlaqueItems: [{ desc: 'HAMPER', qty: 5 }],
    }));
    expect(parsed.remarkNotes).toEqual([
      'PPKI ada perubahan wording',
      'HAMPER — 5 (bukan plak — remark sahaja)',
    ]);
  });

  it('maps questions with stable ids, resolves awardIndex -> sectionIdx', () => {
    const parsed = aiResultToParsed(base({
      awards: [{ eventHeader: 'E', year: '', awardName: 'A', jenisPlak: 'X', plaques: [{ line1: '', line2: '', count: 1 }], statedTotal: null, note: '' }],
      questions: [
        { kind: 'year-inconsistency', text: '2024/2025 or 2025/2026?', options: ['2024/2025', '2025/2026'], awardIndex: 0 },
        { kind: 'other', text: 'Check this', options: [], awardIndex: null },
      ],
    }));
    expect(parsed.questions).toEqual([
      { id: 'ai-q:0', kind: 'year-inconsistency', text: '2024/2025 or 2025/2026?', options: ['2024/2025', '2025/2026'], sectionIdx: 0 },
      { id: 'ai-q:1', kind: 'other', text: 'Check this', options: [], sectionIdx: 0 },
    ]);
  });

  it('resolves an apply block to section indexes and normalises its text', () => {
    const parsed = aiResultToParsed(base({
      awards: [
        { eventHeader: 'SMK X\nEVENT', year: '', awardName: 'A', jenisPlak: '', layout: 'prebuilt', plaques: [{ line1: 'ALI', line2: 'PENGERUSI', count: 1 }], statedTotal: null, note: '' },
        { eventHeader: 'EVENT', year: '', awardName: 'B', jenisPlak: '', layout: 'prebuilt', plaques: [{ line1: 'ABU', line2: 'GURU', count: 1 }], statedTotal: null, note: '' },
      ],
      questions: [
        { kind: 'missing-school-name', text: 'Add school name to award B?', options: ['Add the school name', 'Leave it out'], awardIndex: 1, apply: { action: 'prepend-header', awardIndexes: [1], text: 'SMK X', whenOption: 0 } },
      ],
    }));
    expect(parsed.questions[0].apply).toEqual({ action: 'prepend-header', sectionIdxs: [1], text: 'SMK X', whenOption: 0 });
  });

  it('errors when no award produced any class', () => {
    const parsed = aiResultToParsed(base({
      awards: [{ eventHeader: 'E', year: '', awardName: 'A', jenisPlak: 'X', plaques: [], statedTotal: null, note: '' }],
    }));
    expect(parsed.error).toBeTruthy();
  });
});
