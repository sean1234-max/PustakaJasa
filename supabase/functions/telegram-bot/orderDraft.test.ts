import { describe, it, expect } from 'vitest';
import { readDraftList } from './orderDraft.ts';

const TODAY = '2026-11-05';

describe('readDraftList', () => {
  it("reads Sean's list", () => {
    const text = 'SEKOLAH NAMA: sk taman muda\nCIKGU NAMA: Pn Aisyah\nPHONE NUMBER: 012-345 6789\nKETUA PANITA: En Rahman\nTERMS: l/o\nSHIPMENT DATE: 20/11\nFUNCTION DATE: 23/11/2026';
    expect(readDraftList(text, TODAY)).toEqual({
      fields: {
        sekolah: 'SK TAMAN MUDA', picName: 'PN AISYAH', phone: '012-3456789', ketuaPanitia: 'EN RAHMAN',
        terms: 'L/O', shipmentDate: '2026-11-20', functionDate: '2026-11-23',
      },
      missing: [],
    });
  });

  it('takes the other spellings and says what is missing', () => {
    const r = readDraftList('Nama Sekolah： SJK(C) CHUNG HUA\nKetua Panitia: -\nTerms: cash', TODAY);
    expect(r?.fields).toMatchObject({ sekolah: 'SJK(C) CHUNG HUA', ketuaPanitia: '-', terms: 'Cash' });
    expect(r?.missing).toEqual(['picName', 'phone', 'shipmentDate', 'functionDate']);
  });

  it('is not a list without the school', () => {
    expect(readDraftList('semua PKC 263', TODAY)).toBeNull();
    expect(readDraftList('CIKGU NAMA: X\nTERMS: L/O', TODAY)).toBeNull();
  });

  it('leaves unknown terms blank for the salesman to pick', () => {
    expect(readDraftList('SEKOLAH: SK A\nTERMS: 30 days', TODAY)?.fields.terms).toBe('');
  });
});
