import { describe, it, expect } from 'vitest';
import { productionCards, kivOnlyGroupsDone } from './productionCards';

// ORD-0108 in small: plaques + crystals on the order's own invoice, one invoice of only crystals,
// one of plaques with a crystal, one of plaques only (Sean, 2026-10-28)
const item = (id, jenisPlak, qty) => ({ id, jenisPlak, qty: String(qty), harga: qty * 10, unitPrice: 10, categoryKey: 'TOKOH_SHEET', detail: { rows: [] } });
const order = {
  id: 'ORD-0108', status: 'In Production', invoiceId: 'DWI-518',
  items: [item(1, 'PK 261 / A', 10), item(2, 'CRYSTAL / 00S / DESIGN B', 4), item(3, 'CRYSTAL / R-7 / DESIGN A', 1), item(4, 'YK - 628', 2), item(5, 'PKF 265', 3)],
  invoiceGroups: [
    { invoiceId: 'DWI-524', status: 'In Production', jenisPlakList: ['CRYSTAL / 00S / DESIGN B'] },
    { invoiceId: 'DWI-527', status: 'In Production', jenisPlakList: ['YK - 628', 'CRYSTAL / R-7 / DESIGN A'] },
    { invoiceId: 'DWI-530', status: 'In Production', jenisPlakList: ['PKF 265'] },
  ],
};
const byKey = (cards) => Object.fromEntries(cards.map((c) => [c._sliceKey, c]));

describe('productionCards — each invoice card judged by its own items', () => {
  it('an invoice of only crystals has no plaques of its own; one with crystals is ACARA; the KIV card names the crystals\' invoices', () => {
    const cards = byKey(productionCards(order, null));
    expect(Object.keys(cards)).toEqual(['ORD-0108::DWI-518', 'ORD-0108::DWI-524', 'ORD-0108::DWI-527', 'ORD-0108::DWI-530', 'ORD-0108::DWI-518::kiv']);
    expect(cards['ORD-0108::DWI-524'].items.map((i) => i.jenisPlak)).toEqual(['CRYSTAL / 00S / DESIGN B']);
    expect(cards['ORD-0108::DWI-530'].items.map((i) => i.jenisPlak)).toEqual(['PKF 265']);
    const kiv = cards['ORD-0108::DWI-518::kiv'];
    expect(kiv.items).toBe(order.items);
    expect(kiv._kivInvoices).toEqual(['DWI-524', 'DWI-527']);
    expect(kiv.invoiceId).toBe('DWI-518');
    // the crystal card counts only its crystals, each plaques card only its plaques (2026-10-30)
    expect([kiv.totalQty, kiv.totalAmount]).toEqual([5, 50]);
    expect([cards['ORD-0108::DWI-527'].totalQty, cards['ORD-0108::DWI-527'].totalAmount]).toEqual([2, 20]);
    expect([cards['ORD-0108::DWI-530'].totalQty, cards['ORD-0108::DWI-530'].totalAmount]).toEqual([3, 30]);
  });

  it('an order on one invoice is one card with all its items, as before', () => {
    const one = { ...order, invoiceGroups: [] };
    const cards = productionCards(one, null);
    expect(cards.map((c) => c._part)).toEqual(['main', 'kiv']);
    expect(cards[0].items).toBe(one.items);
    expect(cards[1]._kivInvoices).toEqual([]);
    // ORD-0158: 70 / RM599.50 with 4 crystals at RM76 → ACARA 66 / RM523.50, CRYSTAL 4 / RM76
    const o158 = { id: 'ORD-0158', status: 'In Production', totalAmount: 599.5, items: [item(1, 'PK 261 / A', 66), { ...item(2, 'CRYSTAL / 80-B / DESIGN 1', 4), harga: 76 }], invoiceGroups: [] };
    o158.items[0].harga = 523.5;
    const [acara, crystalCard] = productionCards(o158, null);
    expect([acara.totalQty, acara.totalAmount, crystalCard.totalQty, crystalCard.totalAmount]).toEqual([66, 523.5, 4, 76]);
  });
});

describe('kivOnlyGroupsDone — the KIV & ARTWORK card done completes the invoices that are only crystals', () => {
  it('marks only the crystal-only invoice Completed', () => {
    expect(kivOnlyGroupsDone(order).map((g) => [g.invoiceId, g.status])).toEqual([
      ['DWI-524', 'Completed'], ['DWI-527', 'In Production'], ['DWI-530', 'In Production'],
    ]);
  });
});
