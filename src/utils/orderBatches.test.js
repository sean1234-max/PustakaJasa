import { describe, it, expect } from 'vitest';
import { getOrderInvoiceSlices, getInvoiceItems, normalizeSplitQty, stockDiff, applyPriceDrafts, sortMedalColours, withOrderOwnSettings, combineByJenisPlak, withNamaLines } from './orderBatches';

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

describe('sortMedalColours', () => {
  const codes = (rows) => sortMedalColours(rows.map((jenisPlak) => ({ jenisPlak }))).map((r) => r.jenisPlak);

  it('puts each product\'s GOLD, SILVER, BRONZE together in that order (ORD-0047)', () => {
    expect(codes([
      'SELEMPANG',
      'MP399 / BRONZE / BASE WITHOUT COVER', 'MP399 / GOLD / BASE WITHOUT COVER', 'MP399 / SILVER / BASE WITHOUT COVER',
      'MP393 / BRONZE / BASE WITHOUT COVER', 'MP393 / SILVER / BASE WITHOUT COVER', 'MP393 / GOLD / BASE WITHOUT COVER',
      'DECO LIGHT',
    ])).toEqual([
      'SELEMPANG',
      'MP399 / GOLD / BASE WITHOUT COVER', 'MP399 / SILVER / BASE WITHOUT COVER', 'MP399 / BRONZE / BASE WITHOUT COVER',
      'MP393 / GOLD / BASE WITHOUT COVER', 'MP393 / SILVER / BASE WITHOUT COVER', 'MP393 / BRONZE / BASE WITHOUT COVER',
      'DECO LIGHT',
    ]);
  });

  it('keeps different bases apart and leaves codes without a colour where they were', () => {
    expect(codes(['FD 251 / BRONZE', 'PKC 246', 'FD 251 / GOLD', 'MP399 / SILVER / BASE A', 'MP399 / GOLD / BASE B']))
      .toEqual(['FD 251 / GOLD', 'FD 251 / BRONZE', 'PKC 246', 'MP399 / SILVER / BASE A', 'MP399 / GOLD / BASE B']);
  });
});

describe('withOrderOwnSettings (a corrected Excel saved over the order)', () => {
  it('keeps prices adjusted by hand and the saved row order', () => {
    const order = {
      priceAdjusted: true,
      items: [{ jenisPlak: 'PKF 266', unitPrice: 9, detail: { lines: { 'UMUM::0::refOrder': '1,0' } } }],
    };
    const corrected = [{ categoryKey: 'UMUM', blockIdx: 0, jenisPlak: 'PKF 266', qty: '51', unitPrice: 10, harga: 510, detail: { lines: { 'UMUM::0::0': 'MAJLIS' }, rows: [{ jenisPlak: 'PKF 266', unitPrice: 10 }] } }];
    const [it] = withOrderOwnSettings(order, corrected);
    expect([it.unitPrice, it.harga, it.detail.rows[0].unitPrice, it.detail.lines['UMUM::0::refOrder']]).toEqual([9, 459, 9, '1,0']);
  });
});

describe('one Jenis Plak shared over 4 invoices (ORD-0108)', () => {
  const order = {
    invoiceId: 'DWI-MAIN',
    items: [{ id: 1, jenisPlak: 'PK 261 / A', qty: '300', harga: 3000 }, { id: 2, jenisPlak: 'PK 261 / A', qty: '198', harga: 1980 }, { id: 3, jenisPlak: 'PKF 265', qty: '6', harga: 60 }],
    invoiceGroups: [
      { invoiceId: 'DWI-A', jenisPlakList: ['PK 261 / A'], qtyByJenisPlak: { 'PK 261 / A': 200 } },
      { invoiceId: 'DWI-B', jenisPlakList: ['PK 261 / A'], qtyByJenisPlak: { 'PK 261 / A': 150 } },
      { invoiceId: 'DWI-C', jenisPlakList: ['PK 261 / A'], qtyByJenisPlak: { 'PK 261 / A': 100 } },
    ],
  };
  const qtyOn = (id) => getInvoiceItems(order, id).reduce((s, it) => s + Number(it.qty), 0);
  const hargaOn = (id) => getInvoiceItems(order, id).reduce((s, it) => s + Number(it.harga), 0);
  it('gives each invoice its share and the rest to the main one', () => {
    expect(['DWI-A', 'DWI-B', 'DWI-C', 'DWI-MAIN'].map(qtyOn)).toEqual([200, 150, 100, 54]);
    expect(['DWI-A', 'DWI-B', 'DWI-C', 'DWI-MAIN'].map(hargaOn)).toEqual([2000, 1500, 1000, 540]);
  });
  it('only lets a new share come out of what is still on the main invoice', () => {
    const others = order.invoiceGroups;
    expect(normalizeSplitQty(order.items, ['PK 261 / A'], { 'PK 261 / A': '48' }, others)).toEqual({ qtyByJenisPlak: { 'PK 261 / A': 48 } });
    expect(normalizeSplitQty(order.items, ['PK 261 / A'], { 'PK 261 / A': '49' }, others).error).toMatch(/only 48 left/);
    // retyping DWI-B's share: the other two invoices' shares are what's taken
    expect(normalizeSplitQty(order.items, ['PK 261 / A'], { 'PK 261 / A': '198' }, others.filter((g) => g.invoiceId !== 'DWI-B'))).toEqual({ qtyByJenisPlak: { 'PK 261 / A': 198 } });
  });
});

describe('withNamaLines', () => {
  it('puts the name +RM1 on its own line under the plaque, at the catalog price', () => {
    const items = [
      { id: 'a', jenisPlak: 'YK - 628', qty: 4, unitPrice: 26, harga: 104, nameSurcharge: 1 },
      { id: 'b', jenisPlak: 'YK - 628', qty: 2, unitPrice: 25, harga: 50 },
      { id: 'c', jenisPlak: 'PKC 246', qty: 3, unitPrice: 12, harga: 36 },
    ];
    const lines = withNamaLines(combineByJenisPlak(items, { splitByPrice: true }));
    expect(lines.map((l) => [l.jenisPlak, l.unitPrice, l.qty, l.harga])).toEqual([
      ['YK - 628', 25, 6, 150],
      ['NAMA +RM1', 1, 4, 4],
      ['PKC 246', 12, 3, 36],
    ]);
    expect(lines[0].namaIds).toEqual(['a']);
  });
});
