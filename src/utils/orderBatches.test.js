import { describe, it, expect } from 'vitest';
import { getOrderInvoiceSlices } from './orderBatches';

describe('getOrderInvoiceSlices', () => {
  it('un-split order: one slice, using the order\'s own invoiceId/totalAmount unchanged, totalQty summed from items', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 500, invoiceGroups: [],
      items: [{ id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 }],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false }]);
  });

  it('waiting-for-invoice order (invoiceId still null) with no groups: one slice with a null invoiceId', () => {
    const order = { invoiceId: null, totalAmount: 500, invoiceGroups: [], items: [] };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: null, totalAmount: 500, totalQty: 0, priceAdjusted: false }]);
  });

  it('split order: one slice per invoice, summed from each Jenis Plak\'s own harga/qty', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900,
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false },
      { invoiceId: 'INV-200', totalAmount: 400, totalQty: 40, priceAdjusted: false },
    ]);
  });

  it('everything split away: the default slice is omitted entirely (no card for an empty invoice)', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900,
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKC 263', 'PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-200', totalAmount: 900, totalQty: 50, priceAdjusted: false }]);
  });

  it('multiple splits: default plus every group, each summed independently', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 1000,
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
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: false },
      { invoiceId: 'INV-200', totalAmount: 300, totalQty: 40, priceAdjusted: false },
      { invoiceId: 'INV-300', totalAmount: 200, totalQty: 20, priceAdjusted: false },
    ]);
  });

  it('priceAdjusted is per-slice when a plakCatalog is given: only the invoice whose Jenis Plak price actually changed is flagged', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900,
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['18093 GOLD'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 120, unitPrice: 12 }, // 12 == standard, unchanged
        { id: 'b', jenisPlak: '18093 GOLD', qty: 60, harga: 600, unitPrice: 10 }, // standard is 7, changed
      ],
    };
    const plakCatalog = [{ code: 'PKC 263', price: 12 }, { code: '18093 GOLD', price: 7 }];
    expect(getOrderInvoiceSlices(order, plakCatalog)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 120, totalQty: 10, priceAdjusted: false },
      { invoiceId: 'INV-200', totalAmount: 600, totalQty: 60, priceAdjusted: true },
    ]);
  });

  it('without a plakCatalog, falls back to the order\'s own persisted priceAdjusted flag on every slice', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900, priceAdjusted: true,
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500, totalQty: 10, priceAdjusted: true },
      { invoiceId: 'INV-200', totalAmount: 400, totalQty: 40, priceAdjusted: true },
    ]);
  });
});
