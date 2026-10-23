import { describe, it, expect } from 'vitest';
import {
  isUrgentShipment, prioritizeUrgentOrders, byInvoiceDate, keepTambahanWithParent, urgentCommission, summarizeUrgentCommission, urgentSheetAction,
} from './urgentOrder';

describe('isUrgentShipment — within 7 days of approval, that day counting', () => {
  it('approved on the 7th: the 13th is the last urgent day, the 14th is not', () => {
    expect(isUrgentShipment(new Date(2026, 9, 7), new Date(2026, 9, 13))).toBe(true);
    expect(isUrgentShipment(new Date(2026, 9, 7), new Date(2026, 9, 14))).toBe(false);
  });
  it('weekends count like any other day', () => {
    // 09 Oct 2026 is a Friday: Thu 15th urgent, Fri 16th not.
    expect(isUrgentShipment(new Date(2026, 9, 9), new Date(2026, 9, 15))).toBe(true);
    expect(isUrgentShipment(new Date(2026, 9, 9), new Date(2026, 9, 16))).toBe(false);
  });
  it('reads a stored Shipment Date and crosses months', () => {
    expect(isUrgentShipment(new Date(2026, 9, 28), '2026-11-03T00:00:00+08:00')).toBe(true);
    expect(isUrgentShipment(new Date(2026, 9, 28), '2026-11-04T00:00:00+08:00')).toBe(false);
  });
  it('same day or earlier is urgent; a missing date is not', () => {
    expect(isUrgentShipment(new Date(2026, 9, 7), new Date(2026, 9, 7))).toBe(true);
    expect(isUrgentShipment(null, new Date(2026, 9, 7))).toBe(false);
    expect(isUrgentShipment(new Date(2026, 9, 7), null)).toBe(false);
  });
});

describe('prioritizeUrgentOrders', () => {
  it('places urgent orders first while preserving order within each group', () => {
    const orders = [
      { id: 'regular-1', urgent: false },
      { id: 'urgent-1', urgent: true },
      { id: 'regular-2', urgent: false },
      { id: 'urgent-2', urgent: true },
    ];

    expect(prioritizeUrgentOrders(orders).map((order) => order.id))
      .toEqual(['urgent-1', 'urgent-2', 'regular-1', 'regular-2']);
    expect(orders[0].id).toBe('regular-1');
  });
});

describe('urgent commission', () => {
  it('is 2.5% of the order total, to the sen', () => {
    expect(urgentCommission(4035)).toBe(100.88);
    expect(urgentCommission('1000')).toBe(25);
    expect(urgentCommission(null)).toBe(0);
  });

  it('totals urgent, not-cancelled orders per month and salesman', () => {
    const { rows, months } = summarizeUrgentCommission([
      { id: 'A', urgent: true, status: 'Shipped', sales: 'fida', totalAmount: 1000, datePlaced: '06 Oct 2026' },
      { id: 'B', urgent: true, status: 'In Production', sales: 'fida', totalAmount: 2000, datePlaced: '01 Oct 2026' },
      { id: 'C', urgent: true, status: 'Cancelled', sales: 'fida', totalAmount: 9999, datePlaced: '02 Oct 2026' },
      { id: 'D', urgent: false, status: 'Shipped', sales: 'fida', totalAmount: 9999, datePlaced: '02 Oct 2026' },
      { id: 'E', urgent: true, status: 'Shipped', sales: 'joyce', totalAmount: 400, datePlaced: '30 Sep 2026' },
    ]);
    expect(rows.map((r) => r.order.id)).toEqual(['A', 'B', 'E']);
    expect(months).toEqual([
      { month: 'Oct 2026', commission: 75, salesmen: [{ name: 'fida', count: 2, amount: 3000, commission: 75 }] },
      { month: 'Sep 2026', commission: 10, salesmen: [{ name: 'joyce', count: 1, amount: 400, commission: 10 }] },
    ]);
  });
});

describe('urgentSheetAction', () => {
  it('removes the Sheet row once an order in it is no longer urgent', () => {
    expect(urgentSheetAction({ urgent: false, wasSynced: true, hasInvoice: true })).toBe('remove');
    expect(urgentSheetAction({ urgent: false, wasSynced: false, hasInvoice: true })).toBeNull();
  });
  it('syncs an urgent order already in the Sheet or already invoiced; otherwise waits for the invoice', () => {
    expect(urgentSheetAction({ urgent: true, wasSynced: true, hasInvoice: true })).toBe('sync');
    expect(urgentSheetAction({ urgent: true, wasSynced: false, hasInvoice: true })).toBe('sync');
    expect(urgentSheetAction({ urgent: true, wasSynced: false, hasInvoice: false })).toBeNull();
  });
});

describe('keepTambahanWithParent', () => {
  it("puts a Tambahan's cards right before its parent's cards", () => {
    const cards = [{ id: 'ORD-0091' }, { id: 'ORD-0088', parentOrderId: 'ORD-0069' }, { id: 'ORD-0079' }, { id: 'ORD-0069', part: 'acara' }, { id: 'ORD-0069', part: 'crystal' }, { id: 'ORD-0064' }];
    expect(keepTambahanWithParent(cards).map((c) => c.id + (c.part ? `-${c.part}` : ''))).toEqual(['ORD-0091', 'ORD-0079', 'ORD-0088', 'ORD-0069-acara', 'ORD-0069-crystal', 'ORD-0064']);
  });
  it('leaves a Tambahan in place when its parent is not in the list', () => {
    const cards = [{ id: 'ORD-0088', parentOrderId: 'ORD-0069' }, { id: 'ORD-0064' }];
    expect(keepTambahanWithParent(cards)).toEqual(cards);
  });
});

describe('byInvoiceDate + urgent first', () => {
  it('urgent on top, then the earliest invoice, then no invoice by the soonest Shipment Date', () => {
    const cards = [
      { id: 'inv-late', inv: Date.parse('2026-10-22T02:00:00Z') }, { id: 'no-inv-none' }, { id: 'no-inv-soon', shipmentDate: '2026-10-25' },
      { id: 'inv-early', inv: Date.parse('2026-10-21T02:00:00Z') }, { id: 'urgent', inv: Date.parse('2026-10-23T02:00:00Z'), urgent: true }, { id: 'no-inv-past', shipmentDate: '2026-10-20' },
    ];
    expect(prioritizeUrgentOrders(byInvoiceDate(cards, (c) => c.inv ?? null)).map((c) => c.id))
      .toEqual(['urgent', 'inv-early', 'inv-late', 'no-inv-past', 'no-inv-soon', 'no-inv-none']);
  });

  it('invoices on the same Malaysian day go by the soonest Shipment Date, not the hour (ORD-0085 / ORD-0136)', () => {
    const cards = [
      { id: 'ORD-0085', inv: Date.parse('2026-10-23T04:19:00Z'), shipmentDate: '2026-10-30T00:00:00+08:00', urgent: true },
      { id: 'ORD-0136', inv: Date.parse('2026-10-23T07:19:00Z'), shipmentDate: '2026-10-29T00:00:00+08:00', urgent: true },
    ];
    expect(prioritizeUrgentOrders(byInvoiceDate(cards, (c) => c.inv)).map((c) => c.id)).toEqual(['ORD-0136', 'ORD-0085']);
  });
});

describe('urgent counts from the invoice day (2026-10-23)', () => {
  it('invoiced 23 Oct (stored time) → 29 Oct is urgent, 30 Oct (day 8) is not — ORD-0085', () => {
    const invoiceSetAt = '2026-10-23T04:19:00.454Z';
    expect(isUrgentShipment(invoiceSetAt, '2026-10-29T00:00:00+08:00')).toBe(true);
    expect(isUrgentShipment(invoiceSetAt, '2026-10-30T00:00:00+08:00')).toBe(false);
  });
});
