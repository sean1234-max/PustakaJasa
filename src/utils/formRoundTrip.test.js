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
