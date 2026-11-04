import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { toFormPlaques, type ReadPlaque } from './formPlaques.ts';
import { fillOrderTemplate } from '../../../src/utils/templateExport.js';
import { parseFormAnugerahExcel } from '../../../src/utils/excelImport.js';

const H = 'MAJLIS ANUGERAH KECEMERLANGAN 2026';
const read = (over: Partial<ReadPlaque>): ReadPlaque => ({
  type: 'umum', heading: H, award: '', line3: '', line4: '', subject: '', tahun: null, kelas: '', qty: 1, code: '', ...over,
});

describe('toFormPlaques', () => {
  it('puts a subject per class on the Nama Kelas sheet shape', () => {
    expect(toFormPlaques([read({ type: 'mp_class', subject: 'MATEMATIK', tahun: 2, kelas: 'BESTARI' })]))
      .toEqual([{ heading: H, qty: 1, code: '', award: 'MATEMATIK', line: '2 BESTARI', eline2: '' }]);
  });

  it('sends an MP plaque without its Tahun to ORDER LAIN-LAIN instead of losing it', () => {
    expect(toFormPlaques([read({ type: 'mp_subject', subject: 'SAINS', tahun: null })]))
      .toEqual([{ heading: H, qty: 1, code: '', oneSheet: true, award: 'SAINS', line: '', eline2: '' }]);
  });

  it('drops rows with no quantity', () => {
    expect(toFormPlaques([read({ award: 'JOHAN', qty: 0 })])).toEqual([]);
  });
});

describe('form bot → FORM ANUGERAH → the website reads it back', () => {
  it('fills ORDER LAIN-LAIN and both MP THP sheet kinds', async () => {
    const b = fs.readFileSync('public/templates/FORM-ANUGERAH.xlsx');
    const plaques = toFormPlaques([
      read({ award: 'ANUGERAH PELAJAR CEMERLANG', line3: 'TAHUN 6', qty: 5, code: 'PKC 263' }),
      read({ award: 'JOHAN', line3: 'BOLA SEPAK', qty: 2 }),
      ...['BAHASA MELAYU', 'MATEMATIK'].flatMap((subject) => [[1, 'VENUS'], [1, 'MARS'], [2, 'BESTARI']]
        .map(([tahun, kelas]) => read({ type: 'mp_class', subject, tahun: tahun as number, kelas: kelas as string, code: 'PKC 246' }))),
      read({ type: 'mp_subject', subject: 'BAHASA MELAYU', tahun: 4, code: 'PKC 246' }),
      read({ type: 'mp_subject', subject: 'SAINS', tahun: 5, code: 'PKC 246' }),
    ]);
    const out = await fillOrderTemplate(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      { plaques, selempang: [], front: { sekolah: 'SK TEST' }, priceOf: () => null }, { DOMParser, XMLSerializer });
    expect(out.placed).toEqual({ 'ORDER LAIN-LAIN': 7, 'MP THP 1 (Kalau ada kelas)': 6, 'MP THP 2': 2 });

    const parsed = parseFormAnugerahExcel(out.buffer);
    const shown = (k: string) => (parsed.categorized[k] || []).filter((s: { sourceSheet: string }) => out.sheets.includes(s.sourceSheet.toUpperCase()));
    expect(shown('UMUM')[0].umumRows.map((r: Record<string, unknown>) => [r.l1, r.l2, r.qty, r.jenisPlak]))
      .toEqual([['ANUGERAH PELAJAR CEMERLANG', 'TAHUN 6', 5, 'PKC 263'], ['JOHAN', 'BOLA SEPAK', 2, '']]);
    expect(shown('MP1_KELAS')[0].levelBreakdown.slice(0, 2).map((l: { label: string; mainRows: { name: string }[] }) => [l.label, l.mainRows.map((r) => r.name)]))
      .toEqual([['TAHUN 1', ['VENUS', 'MARS']], ['TAHUN 2', ['BESTARI']]]);
    expect(shown('MP2')[0].classes.map((c: { tahunFrom: string; subjects: { name: string; qty: number }[] }) => [c.tahunFrom, c.subjects.map((s) => s.name)]))
      .toEqual([['TAHUN 4', ['BAHASA MELAYU']], ['TAHUN 5', ['SAINS']]]);
  });
});
