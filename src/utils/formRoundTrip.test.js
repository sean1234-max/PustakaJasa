import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { draftToFormParsed } from './formRoundTrip';

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
