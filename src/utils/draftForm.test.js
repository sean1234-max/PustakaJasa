import { describe, expect, it } from 'vitest';
import { draftPlaques } from './draftForm';

// The FORM ANUGERAH download: the order as it is on the page.
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

describe('draftPlaques', () => {
  it('turns the tabs on the page into plaques', () => {
    const { plaques, skipped } = draftPlaques(draft());
    expect(skipped).toEqual([]);
    expect(plaques.reduce((n, p) => n + p.qty, 0)).toBe(2);
    expect(plaques.every((p) => p.heading === 'MAJLIS BARU 2026' && p.code === 'MP399')).toBe(true);
  });

  it('keeps a tab with no Jenis Plak yet, with a blank KOD, and says so', () => {
    const d = draft();
    d.rowsByBlock['TOKOH_SHEET::0'].forEach((r) => { r.jenisPlak = ''; });
    const { plaques, skipped, unready } = draftPlaques(d);
    expect(skipped).toEqual([]);
    expect(plaques.reduce((n, p) => n + p.qty, 0)).toBe(2);
    expect(plaques.every((p) => p.code === '' && p.heading === 'MAJLIS BARU 2026')).toBe(true);
    expect(unready[0]).toMatch(/^TOKOH: .*Jenis Plak/);
  });

  it('leaves out a tab with no quantity, and says so', () => {
    const d = draft();
    d.rowsByBlock['TOKOH_SHEET::0'].forEach((r) => { r.qty = ''; r.jenisPlak = ''; });
    const { plaques, skipped } = draftPlaques(d);
    expect(plaques).toEqual([]);
    expect(skipped[0]).toMatch(/^TOKOH: /);
  });
});

describe('draftPlaques, a tab with no Jenis Plak row at all', () => {
  it('writes the whole tab in with a blank KOD', async () => {
    const { computeBlocks, noopUpdaters } = await import('./computeBlocks');
    const d = { ...draft(), lineValues: { 'MP1::0::0': 'MAJLIS BARU 2026' }, rowsByBlock: {} };
    const blk = computeBlocks('MP1', d.lineValues, {}, {}, {}, {}, noopUpdaters, d.plakCatalog, 'SK').blocks[0];
    d.matrixValues = { [blk.matrixRows[0].cells[0].key]: '2' };
    const { plaques, unready } = draftPlaques(d);
    expect(plaques.reduce((n, p) => n + p.qty, 0)).toBe(2);
    expect(plaques.every((p) => p.code === '')).toBe(true);
    expect(unready[0]).toMatch(/^MP THP 1: /);
  });
});
