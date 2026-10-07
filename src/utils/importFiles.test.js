import { describe, it, expect } from 'vitest';
import { withImportFile, orderImportFields, orderImportFiles } from './importFiles';
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
});
