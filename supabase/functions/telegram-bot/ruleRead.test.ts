import { describe, it, expect } from 'vitest';
import { ruleRead, type TableRead } from './ruleRead.ts';

const read = (over: Partial<TableRead>): TableRead => ({
  heading: '', notes: [], totalNotes: [], rows: [], listRows: [], noQty: 0, unreadTables: 0, looseText: [], ...over,
});

describe('ruleRead', () => {
  it('takes the row heading and the school under it, the rest as lines 2-4', () => {
    const r = ruleRead(read({ listRows: [{ lines: ['Anugerah Gemilang 2026', 'SK Abdul Samat', 'BOLA JARING', 'NAIB JOHAN'], qty: 10, kod: '18059' }] }));
    expect(r).toMatchObject({ ok: true });
    expect(r.ok && r.input.plaques).toEqual([expect.objectContaining({
      type: 'umum', heading: 'Anugerah Gemilang 2026\nSK Abdul Samat', award: 'BOLA JARING', line3: 'NAIB JOHAN', line4: '', qty: 10, code: '18059',
    })]);
  });

  it('puts short wordings under the document heading, four lines in order', () => {
    const r = ruleRead(read({
      heading: 'MAJLIS ANUGERAH 2026',
      rows: [
        { lines: ['ANUGERAH KEDUDUKAN KELAS', 'TAHUN 1 UTHMAN', 'TEMPAT PERTAMA'], qty: 1, kod: 'PK 020 C' },
        { lines: ['ANUGERAH TERBAIK', 'JEJAK PINTAR AKHIR 2026', 'MATEMATIK', 'TAHUN 1'], qty: 8, kod: 'PK 261 C' },
      ],
    }));
    expect(r.ok && (r.input.plaques as Record<string, unknown>[]).map((p) => [p.heading, p.award, p.line3, p.line4])).toEqual([
      ['MAJLIS ANUGERAH 2026', 'ANUGERAH KEDUDUKAN KELAS', 'TAHUN 1 UTHMAN', 'TEMPAT PERTAMA'],
      ['ANUGERAH TERBAIK', 'JEJAK PINTAR AKHIR 2026', 'MATEMATIK', 'TAHUN 1'],
    ]);
  });

  it('stacks a long medal label in line 2 and keeps a list row in its own order', () => {
    const r = ruleRead(read({
      heading: 'TROFI HARI ANUGERAH',
      rows: [{ lines: ['Anugerah 2026', 'SK A', 'TARIAN', 'KARNIVAL PPKI', 'DAERAH KLANG', 'JOHAN'], qty: 6 }],
      listRows: [{ lines: ['Anugerah Tamat Prasekolah', 'SK Denai Alam', 'Tahun 2026'], qty: 50 }],
    }));
    expect(r.ok && (r.input.plaques as Record<string, unknown>[]).map((p) => [p.heading, p.award, p.line3, p.line4])).toEqual([
      ['Anugerah 2026\nSK A', 'TARIAN\nKARNIVAL PPKI', 'DAERAH KLANG', 'JOHAN'],
      ['Anugerah Tamat Prasekolah', 'SK Denai Alam', 'Tahun 2026', ''],
    ]);
  });

  it('never leaves line 1 empty, and passes on a JUMLAH that does not add up', () => {
    const r = ruleRead(read({ rows: [{ lines: ['TOKOH', 'PELAJAR LELAKI'], qty: 1 }], totalNotes: ['JUMLAH says 3'] }));
    expect(r.ok && (r.input.plaques as Record<string, unknown>[])[0]).toMatchObject({ heading: 'TOKOH', award: 'PELAJAR LELAKI' });
    expect(r.ok && r.input.questions).toEqual(['JUMLAH says 3']);
  });

  it.each([
    ['no table', {}],
    ['a row without a quantity', { rows: [{ lines: ['A'], qty: 1 }], noQty: 1 }],
    ['a table it cannot read', { rows: [{ lines: ['A'], qty: 1 }], unreadTables: 1 }],
    ['a quantity it could not read', { rows: [{ lines: ['A'], qty: 1 }], notes: ['couldn\'t read the quantity "SATU"'] }],
    ['an order outside the tables', { rows: [{ lines: ['A'], qty: 1 }], looseText: ['WOODEN PLAQUE (P261) – 16 PCS'] }],
    ['a nine-line wording', { rows: [{ lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], qty: 1 }] }],
    ['a second code', { rows: [{ lines: ['A'], qty: 1 }, { lines: ['A'], qty: 1, extraKod: true }] }],
    ['two items in one code', { rows: [{ lines: ['A'], qty: 1, kod: '1- YK628 , 2- GTS15' }] }],
  ])('hands the file to the AI: %s', (_why, over) => {
    expect(ruleRead(read(over as Partial<TableRead>)).ok).toBe(false);
  });
});
