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

  it('leaves out a tab that is not ready yet, and says so', () => {
    const d = draft();
    d.rowsByBlock['TOKOH_SHEET::0'][0].jenisPlak = '';
    expect(draftPlaques(d).skipped[0]).toMatch(/^TOKOH: /);
  });
});
