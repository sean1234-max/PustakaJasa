import { describe, expect, test } from 'vitest';
import { diffAddonItems, mergeTambahanItems } from './addonDiff';
import { addonRepeatsOrder } from './addonCheck';

const mp2 = (cells, extra = {}) => ({
  id: 'a', categoryKey: 'MP2', categoryLabel: 'MP THP 2', blockIdx: 0, jenisPlak: 'PKC 263', unitPrice: 12,
  qty: Object.values(cells).reduce((n, v) => n + Number(v), 0),
  harga: 12 * Object.values(cells).reduce((n, v) => n + Number(v), 0),
  detail: {
    lines: { 'MP2::0::0': 'KARNIVAL 2026' },
    matrix: { ...cells, 'MP2::custom-1012::__label__': 'BAHASA MELAYU', 'MP2::custom-1013::__label__': 'SAINS' },
    rows: null, columns: null,
  },
  ...extra,
});

const lonjakan = (desc, qty) => ({
  id: desc, categoryKey: 'LONJAKAN', categoryLabel: 'LONJAKAN', blockIdx: 0, jenisPlak: 'PKF 266', unitPrice: 10, qty: String(qty), harga: 10 * qty,
  detail: { lines: { 'LONJAKAN::0::0': 'KARNIVAL 2026' }, rows: [{ id: 1, desc, qty: String(qty), jenisPlak: 'PKF 266', unitPrice: 10 }], matrix: null, columns: null },
});

const BM = 'MP2::custom-1012::TAHUN 4';
const SAINS = 'MP2::custom-1013::TAHUN 4';

describe('diffAddonItems', () => {
  test('a raised QTY becomes a Tambahan of only the difference', () => {
    const { items, errors } = diffAddonItems([mp2({ [BM]: '10', [SAINS]: '5' })], [mp2({ [BM]: '14', [SAINS]: '5' })]);
    expect(errors).toEqual([]);
    expect(items).toHaveLength(1);
    expect(items[0].qty).toBe(4);
    expect(items[0].harga).toBe(48);
    expect(items[0].detail.matrix).toEqual({ [BM]: '4', 'MP2::custom-1012::__label__': 'BAHASA MELAYU' });
  });

  test('nothing changed gives no Tambahan', () => {
    const base = [mp2({ [BM]: '10' }), lonjakan('TAHUN 1', 3)];
    expect(diffAddonItems(base, [mp2({ [BM]: '10' }), lonjakan('TAHUN 1', 3)])).toEqual({ items: [], errors: [] });
  });

  test('a lowered QTY is refused', () => {
    const { items, errors } = diffAddonItems([mp2({ [BM]: '10', [SAINS]: '5' })], [mp2({ [BM]: '14', [SAINS]: '3' })]);
    expect(items).toEqual([]);
    expect(errors[0]).toMatch(/SAINS/);
  });

  test('a new row comes in whole; a raised one-item-per-row row by its difference', () => {
    const { items, errors } = diffAddonItems([lonjakan('TAHUN 1', 3)], [lonjakan('TAHUN 1', 5), lonjakan('TAHUN 2', 4)]);
    expect(errors).toEqual([]);
    expect(items.map((it) => [it.detail.rows[0].desc, Number(it.qty)])).toEqual([['TAHUN 1', 2], ['TAHUN 2', 4]]);
  });

  test('reworded original row is refused', () => {
    const { errors } = diffAddonItems([lonjakan('TAHUN 1', 3)], [lonjakan('TAHUN 9', 3)]);
    expect(errors[0]).toMatch(/changed or removed/);
  });

  test('a diffed Tambahan is never taken for the order uploaded again', () => {
    const base = [lonjakan('TAHUN 1', 1), lonjakan('TAHUN 2', 1)];
    const { items } = diffAddonItems(base, [lonjakan('TAHUN 1', 2), lonjakan('TAHUN 2', 2)]);
    expect(addonRepeatsOrder(items, base)).toBeNull();
  });
});

describe('mergeTambahanItems', () => {
  test('an earlier Tambahan of the same item is added in, so the next one counts from there', () => {
    const merged = mergeTambahanItems([mp2({ [BM]: '10' })], [mp2({ [BM]: '4' }, { id: 't1' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(14);
    expect(merged[0].detail.matrix[BM]).toBe('14');
    const { items } = diffAddonItems(merged, [mp2({ [BM]: '16' })]);
    expect(items[0].qty).toBe(2);
  });

  test('a new item from an earlier Tambahan joins the order so far', () => {
    const merged = mergeTambahanItems([lonjakan('TAHUN 1', 3)], [lonjakan('TAHUN 2', 4)]);
    expect(merged.map((it) => it.detail.rows[0].desc)).toEqual(['TAHUN 1', 'TAHUN 2']);
  });
});
