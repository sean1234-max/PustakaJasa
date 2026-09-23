import { describe, it, expect } from 'vitest';
import { getOrderInvoiceSlices } from './orderBatches';

describe('getOrderInvoiceSlices', () => {
  it('un-split order: one slice, using the order\'s own invoiceId/totalAmount unchanged', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 500, invoiceGroups: [],
      items: [{ id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 }],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-100', totalAmount: 500 }]);
  });

  it('waiting-for-invoice order (invoiceId still null) with no groups: one slice with a null invoiceId', () => {
    const order = { invoiceId: null, totalAmount: 500, invoiceGroups: [], items: [] };
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: null, totalAmount: 500 }]);
  });

  it('split order: one slice per invoice, summed from each Jenis Plak\'s own harga', () => {
    const order = {
      invoiceId: 'INV-100', totalAmount: 900,
      invoiceGroups: [{ invoiceId: 'INV-200', jenisPlakList: ['PKF 266'] }],
      items: [
        { id: 'a', jenisPlak: 'PKC 263', qty: 10, harga: 500 },
        { id: 'b', jenisPlak: 'PKF 266', qty: 40, harga: 400 },
      ],
    };
    expect(getOrderInvoiceSlices(order)).toEqual([
      { invoiceId: 'INV-100', totalAmount: 500 },
      { invoiceId: 'INV-200', totalAmount: 400 },
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
    expect(getOrderInvoiceSlices(order)).toEqual([{ invoiceId: 'INV-200', totalAmount: 900 }]);
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
      { invoiceId: 'INV-100', totalAmount: 500 },
      { invoiceId: 'INV-200', totalAmount: 300 },
      { invoiceId: 'INV-300', totalAmount: 200 },
    ]);
  });
});
