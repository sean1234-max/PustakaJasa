import { describe, it, expect } from 'vitest';
import { getOrderInvoiceSlices, getInvoiceItems, normalizeSplitQty, stockDiff, applyPriceDrafts } from './orderBatches';

describe('getOrderInvoiceSlices', () => {
  it('un-split order: one slice, using the order\'s own invoiceId/totalAmount/status unchanged, totalQty summed from items', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 500, invoiceGroups: [], status: 'In Production',
      items: [{ id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 }],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false, status: 'In Production' }]);
  });

  it('waiting-for-invoice order (invoiceId still null) with no groups: one slice with a null invoiceId', () => {
    const order = { invoiceId: null, totalAmount: 500, invoiceGroups: [], items: [], status: 'Reviewing Order' };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: null, totalAmount: 500, totalQty: 0, priceAdjusted: false, status: 'Reviewing Order' }]);
  });

  it('split order: one slice per invoice, summed from each Jenis Plak\'s own harga/qty, both following the order\'s status', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, status: 'In Production',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 400, totalQty: 40, priceAdjusted: false, status: 'In Production' },
    ]);
  });

  it('everything split away: the default slice is omitted entirely (no card for an empty invoice)', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, status: 'In Production',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263', 'PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-200', totalAmount: 900, totalQty: 50, priceAdjusted: false, status: 'In Production' }]);
  });

  it('multiple splits: default plus every group, each summed independently', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 1000, status: 'In Production',
      invoiceGroups: [
        { invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] },
        { invoiceId: 'INV-300', jenisPlakList: ['18093 GOLD'] },
      ],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 300 },
        { id: 'c', jenisPlak: '18093 GOLD', qty: 20, harga: 200 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 300, totalQty: 40, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-300', totalAmount: 200, totalQty: 20, priceAdjusted: false, status: 'In Production' },
    ]);
  });

  it('priceAdjusted is per-slice when a plakCatalog is given: only the invoice whose Jenis Plak price actually changed is flagged', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, status: 'In Production',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['18093 GOLD'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 120, unitPrice: 12 }, // 12 == standard, unchanged
        { id: 'b', jenisPlak: '18093 GOLD', qty: 60, harga: 600, unitPrice: 10 }, // standard is 7, changed
      ],
    };
    const plakCatalog = [{ code: 'PKC 263', price: 12 }, { code: '18093 GOLD', price: 7 }];
    expect(getOrderInvoiceSlices(order, plakCatalog)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 120, totalQty: 10, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 600, totalQty: 60, priceAdjusted: true, status: 'In Production' },
    ]);
  });

  it('without a plakCatalog, falls back to the order\'s own persisted priceAdjusted flag on every slice', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, priceAdjusted: true, status: 'In Production',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: true, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 400, totalQty: 40, priceAdjusted: true, status: 'In Production' },
    ]);
  });

  it('a group marked done independently (its own status) no longer follows the order\'s status; a group never marked done still does', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, status: 'In Production',
      invoiceGroups: [
        { invoiceId: 'INV-200', jenisPlakList: ['PKF 266'], status: 'Waiting for Shipment' },
        { invoiceId: 'INV-300', jenisPlakList: ['18093 GOLD'] },
      ],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 300 },
        { id: 'c', jenisPlak: '18093 GOLD', qty: 20, harga: 200 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 300, totalQty: 40, priceAdjusted: false, status: 'Waiting for Shipment' },
      { invoiceId: 'INV-300', totalAmount: 200, totalQty: 20, priceAdjusted: false, status: 'In Production' },
    ]);
  });
});

describe('partial Jenis Plak split (qtyByJenisPlak)', () => {
  const order = {
    invoiceId: 'INV-100', totalAmount: 1150, status: 'In Production',
    invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263'], qtyByJenisPlak: { 'PKC 263': 5 } }],
    items: [
      { id: 'a', jenisPlak: 'PKC 263', qty: 3, harga: 150, unitPrice: 50 },
      { id: 'b', jenisPlak: 'PKC 263', qty: 12, harga: 600, unitPrice: 50 },
      { id: 'c', jenisPlak: 'PKF 266', qty: 40, harga: 400, unitPrice: 10 },
    ],
  };

  it('the group gets only its QTY (taken from the first items first); the rest stays on the default invoice', () => {
    expect(getInvoiceItems(order, 'INV-200')).toEqual([
      { id: 'a', jenisPlak: 'PKC 263', qty: 3, harga: 150, unitPrice: 50 },
      { id: 'b', jenisPlak: 'PKC 263', qty: 2, harga: 100, unitPrice: 50 },
    ]);
    expect(getInvoiceItems(order, 'INV-100')).toEqual([
      { id: 'b', jenisPlak: 'PKC 263', qty: 10, harga: 500, unitPrice: 50 },
      { id: 'c', jenisPlak: 'PKF 266', qty: 40, harga: 400, unitPrice: 10 },
    ]);
  });

  it('slices bill 5 PKC 263 on the new invoice and the other 10 + PKF 266 on the original', () => {
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 900, totalQty: 50, priceAdjusted: false, status: 'In Production' },
      { invoiceId: 'INV-200', totalAmount: 250, totalQty: 5, priceAdjusted: false, status: 'In Production' },
    ]);
  });

  it('normalizeSplitQty: blank or whole-QTY means a full move (no entry); out-of-range is an error', () => {
    const items = order.items;
    expect(normalizeSplitQty(items, ['PKC 263', 'PKF 266'], { 'PKC 263': '5', 'PKF 266': 40 })).toEqual({ qtyByJenisPlak: { 'PKC 263': 5 } });
    expect(normalizeSplitQty(items, ['PKC 263'], {})).toEqual({ qtyByJenisPlak: {} });
    expect(normalizeSplitQty(items, ['PKC 263'], { 'PKC 263': 16 }).error).toMatch(/1 to 15/);
    expect(normalizeSplitQty(items, ['PKC 263'], { 'PKC 263': 0 }).error).toBeTruthy();
    expect(normalizeSplitQty(items, ['PKC 263'], { 'PKC 263': 2.5 }).error).toBeTruthy();
  });
});

describe('stockDiff — stock follows a Production edit', () => {
  it('takes the extra, gives back the cut, ignores what didn\'t change', () => {
    const before = [{ jenisPlak: 'PKC 263', qty: 11 }, { jenisPlak: 'DECO LIGHT', qty: '3' }, { jenisPlak: '18059', qty: 2 }];
    const after = [{ jenisPlak: 'PKC 263', qty: 10 }, { jenisPlak: 'DECO LIGHT', qty: 3 }, { jenisPlak: 'PK 261 / C', qty: 4 }];
    expect(stockDiff(before, after)).toEqual({
      deduct: [{ full_path: 'PK 261 / C', qty: 4 }],
      restore: [{ full_path: 'PKC 263', qty: 1 }, { full_path: '18059', qty: 2 }],
    });
  });

  it('adds up items sharing a Jenis Plak', () => {
    expect(stockDiff([{ jenisPlak: 'A', qty: 2 }, { jenisPlak: 'A', qty: 3 }], [{ jenisPlak: 'A', qty: 6 }]))
      .toEqual({ deduct: [{ full_path: 'A', qty: 1 }], restore: [] });
  });
});

describe('getOrderInvoiceSlices — Done Typing per invoice (0078)', () => {
  it('the order\'s own invoice uses the order\'s typedAt; a split invoice its own (new ones start untyped)', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, status: 'In Production', typedAt: '2026-10-03T01:00:00Z',
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order).map((s) => [s.invoiceId, s.typedAt])).toEqual([
      ['INV-100', '2026-10-03T01:00:00Z'], ['INV-200', undefined],
    ]);
  });
});

describe('applyPriceDrafts', () => {
  const items = [
    { id: 'a', jenisPlak: 'PKC 246', qty: 2, unitPrice: 12, harga: 24 },
    { id: 'b', jenisPlak: 'PKC 246', qty: 1, unitPrice: 12, harga: 12 },
  ];

  it('reprices only the changed item and remembers its old price', () => {
    const { items: out } = applyPriceDrafts(items, { a: '13' });
    expect(out[0]).toMatchObject({ unitPrice: 13, harga: 26, originalUnitPrice: 12 });
    expect(out[1]).toBe(items[1]);
  });

  it('clears the old price when set back to it', () => {
    const { items: out } = applyPriceDrafts([{ ...items[0], unitPrice: 13, harga: 26, originalUnitPrice: 12 }], { a: '12' });
    expect(out[0].unitPrice).toBe(12);
    expect(out[0].harga).toBe(24);
    expect(out[0]).not.toHaveProperty('originalUnitPrice');
  });

  it('rejects a negative or non-numeric price', () => {
    expect(applyPriceDrafts(items, { a: '-1' }).error).toBeTruthy();
    expect(applyPriceDrafts(items, { a: 'abc' }).error).toBeTruthy();
  });
});
