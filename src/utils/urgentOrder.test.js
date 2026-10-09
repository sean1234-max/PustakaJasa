import { describe, it, expect } from 'vitest';
import {
  isUrgentShipment, prioritizeUrgentOrders, urgentCommission, summarizeUrgentCommission, urgentSheetAction,
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
