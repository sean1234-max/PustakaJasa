import { describe, it, expect } from 'vitest';
import { editedOrderFiles } from './importFiles';

const NOW = '2026-11-07T08:00:00.000Z';
const order = {
  importFiles: [{ path: 'old/a.xlsx', name: 'a.xlsx' }],
  correctedImportFilePath: null,
};
const item = (id, importFile) => ({ id, jenisPlak: 'PKC 263', qty: 1, harga: 10, ...(importFile ? { importFile } : {}) });

describe('editedOrderFiles', () => {
  it('no new upload: the order keeps its files, nothing replaced', () => {
    const st = { importFiles: [], cart: [item('1', 'old/a.xlsx')] };
    const r = editedOrderFiles(order, st, NOW);
    expect(r.newFiles).toEqual([]);
    expect(r.replaced).toEqual([]);
    expect(r.items[0].importFile).toBe('old/a.xlsx');
  });

  it('a new upload replaces the old file, which is kept with when it was replaced', () => {
    const st = { importFiles: [{ path: 'new/b.xlsx', name: 'b.xlsx' }], cart: [item('1', 'new/b.xlsx'), item('2', 'old/a.xlsx')] };
    const r = editedOrderFiles(order, st, NOW);
    expect(r.newFiles).toEqual([{ path: 'new/b.xlsx', name: 'b.xlsx' }]);
    expect(r.replaced).toEqual([{ path: 'old/a.xlsx', name: 'a.xlsx', replacedAt: NOW }]);
    expect(r.items[0].importFile).toBe('new/b.xlsx');
    expect('importFile' in r.items[1]).toBe(false);
  });

  it('an upload no cart item came from still becomes the order file', () => {
    const st = { importFiles: [{ path: 'new/b.xlsx', name: 'b.xlsx' }], cart: [item('1', 'old/a.xlsx')] };
    const r = editedOrderFiles(order, st, NOW);
    expect(r.newFiles).toEqual([{ path: 'new/b.xlsx', name: 'b.xlsx' }]);
    expect(r.replaced.map((f) => f.path)).toEqual(['old/a.xlsx']);
  });

  it("Production's Corrected Excel is always replaced", () => {
    const corrected = { ...order, correctedImportFilePath: 'c/fix.xlsx', correctedImportFileName: 'fix.xlsx' };
    const r = editedOrderFiles(corrected, { importFiles: [], cart: [item('1')] }, NOW);
    expect(r.newFiles).toEqual([]);
    expect(r.replaced).toEqual([{ path: 'c/fix.xlsx', name: 'fix.xlsx', corrected: true, replacedAt: NOW }]);
  });

  it('an older order with only import_file_path', () => {
    const legacy = { importFilePath: 'old/x.xlsx', importFileName: 'x.xlsx' };
    const r = editedOrderFiles(legacy, { importFiles: [{ path: 'new/y.xlsx', name: 'y.xlsx' }], cart: [item('1', 'new/y.xlsx')] }, NOW);
    expect(r.replaced.map((f) => f.path)).toEqual(['old/x.xlsx']);
  });
});
