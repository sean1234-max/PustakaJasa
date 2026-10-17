import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { fillOrderTemplate, planTemplateFill } from './templateExport';

// A made-up, cut-down FORM ANUGERAH: the labels the filler looks for, in
// the same places as the real template.
function makeTemplate() {
  const wb = XLSX.utils.book_new();
  const mp = [];
  mp[0] = ['', 'TOLONG ISI DI SINI'];
  mp[10] = ['SUBJEK', '', '', '', '', 'Tahun 1', '', '', '', '', 'Tahun 2', '', '', '', '', 'Tahun 3'];
  mp[11] = ['', 'TAHUN 1', 'TAHUN 2', 'TAHUN 3', '', 'Nama Kelas', 'QTY', '', '', '', 'Nama Kelas', 'QTY', '', '', '', 'Nama Kelas', 'QTY'];
  mp[15] = ['BAHASA CINA']; // the template's own sample subject
  mp[16] = ['TOTAL'];
  mp[18] = ['', 'JENIS PLAK', 'QTY'];
  const mpWs = XLSX.utils.aoa_to_sheet(mp.map((r) => r || []));
  mpWs.B13 = { t: 'n', v: 0, f: 'SUM(G13:G16)' };
  XLSX.utils.book_append_sheet(wb, mpWs, 'MP THP 1 (Kalau ada kelas)');
  const pk = [];
  pk[0] = ['', '', 'TOLONG ISI DI SINI'];
  pk[9] = ['SUBJEK', 'KUANTITI', '', '', '', 'PRA PPKI', '', '', '', '', 'PPKI'];
  pk[10] = ['', 'PRA PPKI', 'PPKI', 'PRASEKOLAH', '', 'Nama Kelas', 'QTY', '', '', '', 'Nama Kelas', 'QTY'];
  pk[14] = ['BAHASA TAMIL'];
  pk[15] = ['TOTAL'];
  pk[17] = ['', 'JENIS PLAK'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pk.map((r) => r || [])), 'PPKI,PRA');
  const um = [];
  um[4] = ['①'];
  um[5] = ['②'];
  um[10] = ['No.', '①', '②', '③', '④', 'KUANTITI', 'JENIS PLAK'];
  um[11] = ['1'];
  um[12] = ['2'];
  um[13] = ['3'];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(um.map((r) => r || [])), 'ORDER LAIN-LAIN');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

const tab = (award, code, lines) => [{
  lines: { 0: 'MAJLIS APRESIASI AKADEMIK', 2: award },
  jenisPlak: code,
  classes: lines.map((l) => ({ namaKelas: l, eline2: '', subjects: [{ name: 'KUANTITI', qty: 1 }] })),
}];

const order = {
  a: tab('ANUGERAH IBNU SINA', 'PKC 263', ['1 UM', '1 UKM', '2 UM']),
  b: tab('ANUGERAH AL-KINDI', 'PKC 263', ['1 UM', '1 UKM', '2 UM']),
  c: tab('ANUGERAH SHAKESPEARE', 'PKC 246', ['1 UM', '1 UKM', '2 UM']),
  d: tab('ANUGERAH AL-FARABI', 'PKC 263', ['ALIRAN TAHUN 1 PPKI', 'ALIRAN TAHUN 2 PPKI']),
  e: tab('ANUGERAH CHOLAR', 'PKC 263', ['TAHUN 1', 'TAHUN 2']),
  f: tab('ANUGERAH SIBAWEIH', 'PKC 263', ['1 UM']),
};

const read = (buffer) => XLSX.read(buffer, { type: 'array' });
const v = (wb, sheet, ref) => wb.Sheets[sheet][ref]?.v;

describe('planTemplateFill', () => {
  it('sorts class awards, PPKI and the rest, and keeps odd awards apart', () => {
    const plan = planTemplateFill(order);
    expect(plan.mp.map((g) => [g.code, g.awards])).toEqual([
      ['PKC 263', ['ANUGERAH IBNU SINA', 'ANUGERAH AL-KINDI']],
      ['PKC 246', ['ANUGERAH SHAKESPEARE']],
    ]);
    expect(plan.ppki[0].levels).toEqual([{ label: 'ALIRAN TAHUN 1', qty: 1 }, { label: 'ALIRAN TAHUN 2', qty: 1 }]);
    // SIBAWEIH goes to one class only, so it can't share the class list.
    expect(plan.umum.map((p) => `${p.award} / ${p.line}`)).toEqual([
      'ANUGERAH CHOLAR / TAHUN 1', 'ANUGERAH CHOLAR / TAHUN 2', 'ANUGERAH SIBAWEIH / 1 UM',
    ]);
    expect(plan.plaqueCount).toBe(3 + 3 + 3 + 2 + 2 + 1);
  });

  it('puts every wording in capitals, keeping heading line breaks', () => {
    const plan = planTemplateFill({ plaques: [{ heading: 'Hari Anugerah\nKualiti 2026', award: 'Terbaik Pentaksiran', line: 'Tahun 1', eline2: 'naib johan', code: '', qty: 2 }] });
    expect(plan.umum).toEqual([{ heading: 'HARI ANUGERAH\nKUALITI 2026', award: 'TERBAIK PENTAKSIRAN', line: 'TAHUN 1', eline2: 'NAIB JOHAN', code: '', qty: 2 }]);
  });
});

describe('fillOrderTemplate', () => {
  it('fills the sheets, adds a copy for a second code, and keeps formulas', async () => {
    const res = await fillOrderTemplate(makeTemplate(), order, { DOMParser, XMLSerializer });
    const wb = read(res.buffer);
    const mp = 'MP THP 1 (Kalau ada kelas)';
    expect(wb.SheetNames).toEqual([mp, `${mp} (2)`, 'PPKI,PRA', 'ORDER LAIN-LAIN']);
    expect(v(wb, mp, 'B2')).toBe('MAJLIS APRESIASI AKADEMIK');
    expect(v(wb, mp, 'B3')).toBe('ANUGERAH IBNU SINA\n1 UM');
    expect([v(wb, mp, 'A13'), v(wb, mp, 'A14')]).toEqual(['ANUGERAH IBNU SINA', 'ANUGERAH AL-KINDI']);
    expect([v(wb, mp, 'B13'), v(wb, mp, 'C13'), v(wb, mp, 'D13')]).toEqual([2, 1, undefined]);
    expect([v(wb, mp, 'F13'), v(wb, mp, 'G13'), v(wb, mp, 'F14'), v(wb, mp, 'K13')]).toEqual(['UM', 1, 'UKM', 'UM']);
    expect(v(wb, mp, 'B20')).toBe('PKC 263');
    expect([v(wb, mp, 'A16'), v(wb, `${mp} (2)`, 'A16'), v(wb, 'PPKI,PRA', 'A15')]).toEqual([undefined, undefined, undefined]);
    expect(v(wb, `${mp} (2)`, 'A13')).toBe('ANUGERAH SHAKESPEARE');
    expect(v(wb, `${mp} (2)`, 'B20')).toBe('PKC 246');
    expect(v(wb, 'PPKI,PRA', 'A12')).toBe('ANUGERAH AL-FARABI');
    expect([v(wb, 'PPKI,PRA', 'C12'), v(wb, 'PPKI,PRA', 'K12'), v(wb, 'PPKI,PRA', 'L13')]).toEqual([2, 'ALIRAN TAHUN 1', 1]);
    expect(v(wb, 'ORDER LAIN-LAIN', 'B5')).toBe('MAJLIS APRESIASI AKADEMIK');
    expect([v(wb, 'ORDER LAIN-LAIN', 'C12'), v(wb, 'ORDER LAIN-LAIN', 'F12'), v(wb, 'ORDER LAIN-LAIN', 'G12')])
      .toEqual(['ANUGERAH CHOLAR\nTAHUN 1', 1, 'PKC 263']);
    expect(v(wb, 'ORDER LAIN-LAIN', 'C14')).toBe('ANUGERAH SIBAWEIH\n1 UM');
    expect(res.placed).toEqual({ [mp]: 6, [`${mp} (2)`]: 3, 'PPKI,PRA': 2, 'ORDER LAIN-LAIN': 3 });
    expect(Object.values(res.placed).reduce((a, n) => a + n, 0)).toBe(res.plaqueCount);
  });

  it('adds another ORDER LAIN-LAIN when the rows run out', async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i, tab(`ANUGERAH ${i}`, 'PKC 263', ['TAHUN 1'])]));
    const res = await fillOrderTemplate(makeTemplate(), many, { DOMParser, XMLSerializer });
    const wb = read(res.buffer);
    expect(wb.SheetNames).toContain('ORDER LAIN-LAIN (2)');
    expect(v(wb, 'ORDER LAIN-LAIN (2)', 'C13')).toBe('ANUGERAH 4\nTAHUN 1');
    expect(res.placed).toEqual({ 'ORDER LAIN-LAIN': 3, 'ORDER LAIN-LAIN (2)': 2 });
  });
});
