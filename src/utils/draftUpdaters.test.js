import { describe, it, expect } from 'vitest';
import { createDraftUpdaters } from './draftUpdaters';
import { getCustomMatrixRowIds, customMatrixLabelKey, matrixCellKey } from '../data/catalog';

const FIELDS = {
  lineValues: 'lineValues', matrixValues: 'matrixValues', rowsByBlock: 'rowsByBlock', plakRows: 'plakRows',
  columnsByBlock: 'columnsByBlock', nextRowId: 'nextRowId', nextColumnId: 'nextColumnId', nextPlakRowId: 'nextPlakRowId',
  visibleBlocksByCategory: 'visibleBlocksByCategory',
};
// a tiny store: patch(updater) merges like AppState's patch
function store(initial) {
  let st = initial;
  const patch = (u) => { st = { ...st, ...(typeof u === 'function' ? u(st) : u) }; };
  return { get: () => st, updaters: createDraftUpdaters(patch, FIELDS) };
}

describe('onAddMatrixRow', () => {
  it('keeps the subjects on screen (and their quantities) when the first row is added', () => {
    const s = store({ matrixValues: { [matrixCellKey('MP1', 'BAHASA MELAYU', 'TAHUN 1')]: '3' }, nextRowId: 10 });
    s.updaters.onAddMatrixRow('MP1', ['BAHASA MELAYU', 'MATEMATIK'], ['TAHUN 1']);
    const mv = s.get().matrixValues;
    expect(getCustomMatrixRowIds('MP1', mv)).toEqual(['10', '11', '12']);
    expect(mv[customMatrixLabelKey('MP1', 10)]).toBe('BAHASA MELAYU');
    expect(mv[customMatrixLabelKey('MP1', 11)]).toBe('MATEMATIK');
    expect(mv[customMatrixLabelKey('MP1', 12)]).toBe('');
    expect(mv[matrixCellKey('MP1', 'custom-10', 'TAHUN 1')]).toBe('3');
    expect(mv[matrixCellKey('MP1', 'BAHASA MELAYU', 'TAHUN 1')]).toBeUndefined();
    expect(s.get().nextRowId).toBe(13);
  });

  it('just adds a row once the tab already has its own rows', () => {
    const s = store({ matrixValues: { [customMatrixLabelKey('MP1', 5)]: 'SAINS' }, nextRowId: 6 });
    s.updaters.onAddMatrixRow('MP1');
    expect(getCustomMatrixRowIds('MP1', s.get().matrixValues)).toEqual(['5', '6']);
  });
});

describe('onCopyCategory', () => {
  it('copies every value of the tab under the new key and shows the copy', () => {
    const s = store({
      lineValues: { 'UMUM::0::0': 'MAJLIS 2026', 'MP1::0::0': 'OTHER TAB' },
      matrixValues: {}, rowsByBlock: { 'UMUM::0': [{ id: 1, l1: 'ANUGERAH', qty: '2' }] },
      columnsByBlock: {}, plakRows: { 'UMUM::0': [{ id: 1, jenisPlak: 'PKC 263' }] }, visibleBlocksByCategory: { UMUM: 1 },
    });
    s.updaters.onCopyCategory('UMUM', 'DYN::UMUM::COPY');
    const st = s.get();
    expect(st.lineValues['DYN::UMUM::COPY::0::0']).toBe('MAJLIS 2026');
    expect(st.lineValues['MP1::0::0']).toBe('OTHER TAB');
    expect(st.rowsByBlock['DYN::UMUM::COPY::0']).toEqual([{ id: 1, l1: 'ANUGERAH', qty: '2' }]);
    expect(st.rowsByBlock['DYN::UMUM::COPY::0']).not.toBe(st.rowsByBlock['UMUM::0']);
    expect(st.plakRows['DYN::UMUM::COPY::0'][0].jenisPlak).toBe('PKC 263');
    expect(st.visibleBlocksByCategory['DYN::UMUM::COPY']).toBe(1);
  });
});
