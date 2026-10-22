import { describe, it, expect } from 'vitest';
import { withImportFile, tagImportFiles, orderImportFields, orderImportFiles } from './importFiles';
import { nextFreeCategoryKey, makeDynamicCategoryKey, resolveCategory } from '../data/catalog';
import { buildOrderImportFilename } from './exportCsv';

describe('order import files', () => {
  const A = { path: 'u/a.xlsx', name: 'BIDANG.xlsx' };
  const B = { path: 'u/b.xlsx', name: 'JZ.xlsx' };

  it('an order keeps the files its cart items came from, not a later unused upload', () => {
    const cart = withImportFile([{ id: 1 }, { id: 2 }], A.path);
    expect(orderImportFields({ cart, importFiles: [A, B], importFilePath: B.path, importFileName: B.name }))
      .toEqual({ importFilePath: A.path, importFileName: A.name, importFiles: [A] });
  });

  it('keeps every file when the cart mixes two imports', () => {
    const cart = [...withImportFile([{ id: 1 }], A.path), ...withImportFile([{ id: 2 }], B.path)];
    expect(orderImportFields({ cart, importFiles: [A, B], importFilePath: B.path }).importFiles).toEqual([A, B]);
  });

  it('falls back to the latest upload when no cart item was tagged', () => {
    expect(orderImportFields({ cart: [{ id: 1 }], importFiles: [B], importFilePath: B.path, importFileName: B.name }).importFiles).toEqual([B]);
    expect(orderImportFields({ cart: [], importFiles: [] }).importFiles).toEqual([]);
  });

  it('reads older orders that only have the single file', () => {
    expect(orderImportFiles({ importFilePath: 'u/x.xlsx', importFileName: 'x.xlsx' })).toEqual([{ path: 'u/x.xlsx', name: 'x.xlsx' }]);
    expect(orderImportFiles({ importFiles: [A, B], importFilePath: A.path })).toEqual([A, B]);
  });

  it('numbers an order\'s second file "-2"', () => {
    const order = { id: 'ORD-0025', sekolah: 'SK NILAI IMPIAN', sales: 'onn' };
    expect(buildOrderImportFilename(order, A, 0)).toBe('ORD-0025-SK NILAI IMPIAN(onn).xlsx');
    expect(buildOrderImportFilename(order, B, 1)).toBe('ORD-0025-SK NILAI IMPIAN(onn)-2.xlsx');
  });

  it('tags each cart item with the uploaded file its tab came from', () => {
    const st = {
      importFiles: [A, B], importFilePath: B.path,
      step2UploadedFiles: [{ name: A.name, categories: ['PPKI'] }, { name: B.name, categories: ['UMUM'] }],
    };
    expect(tagImportFiles([{ categoryKey: 'PPKI' }, { categoryKey: 'UMUM' }, { categoryKey: 'MP1' }], st).map((it) => it.importFile))
      .toEqual([A.path, B.path, B.path]);
  });

  it("opens another file's copy of a filled tab as '<tab> (2)', '(3)' …", () => {
    const ppki2 = makeDynamicCategoryKey('PPKI', 'PPKI (2)');
    expect(nextFreeCategoryKey('PPKI', new Set(['PPKI']))).toBe(ppki2);
    expect(nextFreeCategoryKey('PPKI', new Set(['PPKI', ppki2]))).toBe(makeDynamicCategoryKey('PPKI', 'PPKI (3)'));
    expect(resolveCategory(ppki2)).toMatchObject({ label: 'PPKI (2)', mode: resolveCategory('PPKI').mode });
    const tab = makeDynamicCategoryKey('UMUM', 'SET ALAS TULIS');
    expect(nextFreeCategoryKey(tab, new Set([tab]))).toBe(makeDynamicCategoryKey('UMUM', 'SET ALAS TULIS (2)'));
  });
});
