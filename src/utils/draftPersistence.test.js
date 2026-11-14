import { describe, it, expect, beforeEach } from 'vitest';
import { loadDraft, saveDraft, clearDraft, draftHasContent } from './draftPersistence';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';

const blank = () => ({
  sekolah: 'SK TEST', schoolLanguage: 'SK', terms: '', lineValues: {}, matrixValues: {}, cart: [],
  rowsByBlock: buildInitialRowsByBlock('SK'), columnsByBlock: buildInitialColumnsByBlock(), plakRows: buildInitialPlakRows(),
});

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});

describe('draftPersistence', () => {
  it('a blank form (just the account\'s school) is not a draft', () => {
    expect(draftHasContent(blank())).toBe(false);
    expect(draftHasContent({ ...blank(), picName: 'KOKO' })).toBe(true);
    expect(draftHasContent({ ...blank(), funcSelected: new Date() })).toBe(true);
    expect(draftHasContent({ ...blank(), lineValues: { 'UMUM::0::0': '' } })).toBe(false);
  });

  it('a row typed into a table counts as a draft', () => {
    const st = blank();
    const key = Object.keys(st.rowsByBlock)[0];
    const rowsByBlock = { ...st.rowsByBlock, [key]: [...st.rowsByBlock[key], { id: 9999, desc: 'X', qty: '1' }] };
    expect(draftHasContent({ ...st, rowsByBlock })).toBe(true);
  });

  it('comes back for the same account only, with its dates', () => {
    const func = new Date('2026-11-19T00:00:00+08:00');
    saveDraft('user-a', { ...blank(), picName: 'KOKO', funcSelected: func, cart: [{ categoryKey: 'UMUM', qty: 2 }], orders: ['not kept'] });
    const back = loadDraft('user-a');
    expect(back.picName).toBe('KOKO');
    expect(back.funcSelected.getTime()).toBe(func.getTime());
    expect(back.cart).toEqual([{ categoryKey: 'UMUM', qty: 2 }]);
    expect(back.orders).toBeUndefined();
    expect(loadDraft('user-b')).toBeNull();
    clearDraft('user-a');
    expect(loadDraft('user-a')).toBeNull();
  });

  it('ignores a broken saved copy', () => {
    localStorage.setItem('pj.newOrderDraft.v2:user-a', '{not json');
    expect(loadDraft('user-a')).toBeNull();
    localStorage.setItem('pj.newOrderDraft.v2:user-a', JSON.stringify({ cart: 'x' }));
    expect(loadDraft('user-a')).toBeNull();
  });
});
