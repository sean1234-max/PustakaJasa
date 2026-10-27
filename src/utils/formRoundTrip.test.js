import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { draftToFormParsed } from './formRoundTrip';
import { makeDynamicCategoryKey } from '../data/catalog';

const template = () => {
  const b = fs.readFileSync('public/templates/FORM-ANUGERAH.xlsx');
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const opts = { DOMParser, XMLSerializer };
const draft = () => ({
  lineValues: { 'TOKOH_SHEET::0::0': 'MAJLIS BARU 2026', 'TOKOH_SHEET::0::2': 'TOKOH MURID' },
  matrixValues: {},
  rowsByBlock: { 'TOKOH_SHEET::0': [
    { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
    { id: 2, desc: 'TOKOH NILAM', qty: '1', jenisPlak: 'MP399', namaMurid: 'Siti' },
  ] },
  plakRows: {},
  columnsByBlock: {},
  visibleBlocksByCategory: {},
  plakCatalog: [{ code: 'MP399', price: 12 }],
  schoolLanguage: 'SK',
});

describe('draftToFormParsed', () => {
  it('reads the tabs back the way an uploaded FORM ANUGERAH is read', async () => {
    const { parsed, error } = await draftToFormParsed(draft(), ['TOKOH_SHEET'], template(), opts);
    expect(error).toBeUndefined();
    const rows = parsed.categorized.TOKOH_SHEET.flatMap((s) => s.tokohRows || []).filter((r) => r.qty);
    expect(rows.map((r) => [r.desc, r.qty, r.jenisPlak])).toEqual([['TOKOH MURID', 1, 'MP399'], ['TOKOH NILAM', 1, 'MP399']]);
  });

  it('only takes the tabs it is given', async () => {
    const { error } = await draftToFormParsed(draft(), ['MP1'], template(), opts);
    expect(error).toMatch(/nothing to put in the form/);
  });

  it('leaves the tabs as read when one has no quantity yet', async () => {
    const d = draft();
    d.rowsByBlock['TOKOH_SHEET::0'].forEach((r) => { r.qty = ''; r.jenisPlak = ''; });
    const { error } = await draftToFormParsed(d, ['TOKOH_SHEET'], template(), opts);
    expect(error).toMatch(/no quantity yet/);
  });
});

describe('draftToFormParsed, line order', () => {
  it('leaves the tabs as read when a tab engraves its lines in another order', async () => {
    const d = draft();
    d.lineValues['TOKOH_SHEET::0::refOrder'] = '0,3,2';
    const { error } = await draftToFormParsed(d, ['TOKOH_SHEET'], template(), opts);
    expect(error).toMatch(/different order/);
  });

  it('goes ahead when the lines are in the usual order', async () => {
    const d = draft();
    d.lineValues['TOKOH_SHEET::0::refOrder'] = '0,2,3';
    const { error } = await draftToFormParsed(d, ['TOKOH_SHEET'], template(), opts);
    expect(error).toBeUndefined();
  });
});

describe('draftToFormParsed, a tab of its own', () => {
  it('comes back as a tab of the same name', async () => {
    const key = makeDynamicCategoryKey('TOKOH_SHEET', 'IKON PENGAWAS');
    const d = draft();
    d.lineValues = { [`${key}::0::0`]: 'MAJLIS 2026', [`${key}::0::2`]: 'IKON PENGAWAS' };
    d.rowsByBlock = { [`${key}::0`]: [{ id: 1, desc: 'IKON PENGAWAS', qty: '2', jenisPlak: 'MP399', namaMurid: 'TAHUN 3' }] };
    d.visibleBlocksByCategory = { [key]: [0] };
    const { parsed, error } = await draftToFormParsed(d, [key], template(), opts);
    expect(error).toBeUndefined();
    expect(Object.keys(parsed.categorized)).toEqual([key]);
    const [sec] = parsed.categorized[key];
    expect([sec.sourceSheet, sec.dynamicCategoryKey]).toEqual(['IKON PENGAWAS', key]);
    expect(sec.tokohRows.filter((r) => r.qty).map((r) => [r.desc, r.namaMurid, r.qty])).toEqual([['IKON PENGAWAS', 'TAHUN 3', 2]]);
  });
});

// SK Taman Sri Andalas (Sean, 2026-10-27): a PDF tab of KETUA KELAS 2026 for 1 MAHIR, 1 YAKIN …
// came back from the form as TAHUN 1 x 9, the class names gone, in two tabs.
describe('draftToFormParsed, a class per plaque', () => {
  it('puts the tab on ORDER LAIN-LAIN: the form\'s class sheets cannot keep its class names', async () => {
    const key = makeDynamicCategoryKey('KLAS_MATRIX', 'KETUA KELAS 2026');
    const classes = ['1 MAHIR', '1 YAKIN', '2 MAHIR', '4 MAHIR', '4 YAKIN'];
    const d = {
      lineValues: { [`${key}::0::0`]: 'SEKOLAH KEBANGSAAN TAMAN SRI ANDALAS\nUNIT HAL EHWAL MURID', [`${key}::0::2`]: 'KETUA KELAS 2026', [`${key}::0::3`]: '1 MAHIR', [`${key}::0::refOrder`]: '0,2,3' },
      matrixValues: Object.fromEntries(classes.map((_, i) => [`${key}::0::1::${i + 1}`, '1'])),
      rowsByBlock: { [`${key}::0`]: [{ id: 1, desc: 'KUANTITI', custom: true }] },
      columnsByBlock: { [`${key}::0`]: classes.map((namaKelas, i) => ({ id: i + 1, tahunFrom: '', tahunTo: '', namaKelas })) },
      plakRows: { [`${key}::0`]: [{ id: 1, jenisPlak: 'SM-13187 / GOLD / BASE WITHOUT COVER' }] },
      visibleBlocksByCategory: { [key]: 1 },
      plakCatalog: [{ code: 'SM-13187', price: 5.5, children: [{ code: 'GOLD', children: [{ code: 'BASE WITHOUT COVER' }] }] }],
      schoolLanguage: 'SK',
    };
    const { error, parsed } = await draftToFormParsed(d, [key], template(), opts);
    expect(error).toBeUndefined();
    // on ORDER LAIN-LAIN, a row per class, the award red (Sean: 永远打直)
    const [section] = parsed.categorized[makeDynamicCategoryKey('UMUM', 'KETUA KELAS 2026')];
    expect(section.lines.umumRed).toBe('1');
    expect(section.umumRows.map((r) => [r.l1, r.l2, r.qty])).toEqual(classes.map((c) => ['KETUA KELAS 2026', c, 1]));
  });
});

describe('MP THP (Kalau ada kelas) CONTOH', () => {
  it('the award in ②, the class in ③ under it — not red (Sean, 2026-10-27)', async () => {
    const { fillOrderTemplate } = await import('./templateExport');
    const { parseFormAnugerahExcel } = await import('./excelImport');
    const plaques = ['MAHIR', 'YAKIN'].flatMap((k) => [1, 2, 3].map((y) => ({
      heading: 'SK TAMAN SRI ANDALAS', award: 'KETUA KELAS 2026', line: `${y} ${k}`, eline2: '', qty: 1, code: 'SM-13187',
    })));
    const out = await fillOrderTemplate(template(), { plaques, selempang: [], front: {}, priceOf: () => null }, opts);
    const [section] = parseFormAnugerahExcel(out.buffer).categorized.MP1_KELAS;
    expect([section.lines['2'], section.lines['3']]).toEqual(['KETUA KELAS 2026', '1 MAHIR']);
    expect(section.levelBreakdown.map((l) => l.mainRows.map((r) => r.name))).toEqual([['MAHIR', 'YAKIN'], ['MAHIR', 'YAKIN'], ['MAHIR', 'YAKIN']]);
  });
});
