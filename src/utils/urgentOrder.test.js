import { describe, it, expect } from 'vitest';
import {
  countWorkingDaysBetween, isUrgentShipment, prioritizeUrgentOrders, urgentCommission, summarizeUrgentCommission, urgentSheetAction,
} from './urgentOrder';

// 2026-09-21 is a Monday.
const MON = new Date(2026, 8, 21);
const TUE = new Date(2026, 8, 22);
const FRI = new Date(2026, 8, 25);
const SAT = new Date(2026, 8, 26);
const SUN = new Date(2026, 8, 27);
const NEXT_MON = new Date(2026, 8, 28);
const NEXT_TUE = new Date(2026, 8, 29);
const NEXT_FRI = new Date(2026, 9, 2);

describe('countWorkingDaysBetween', () => {
  it('counts 0 for the same day', () => {
    expect(countWorkingDaysBetween(MON, MON)).toBe(0);
  });

  it('counts 0 when toDate is before fromDate', () => {
    expect(countWorkingDaysBetween(FRI, MON)).toBe(0);
  });

  it('counts weekdays only, Mon -> Fri (4 days: Tue,Wed,Thu,Fri)', () => {
    expect(countWorkingDaysBetween(MON, FRI)).toBe(4);
  });

  it('skips the weekend, Fri -> next Mon (1 day)', () => {
    expect(countWorkingDaysBetween(FRI, NEXT_MON)).toBe(1);
  });

  it('Mon -> next Mon = 5 working days (Tue,Wed,Thu,Fri,Mon)', () => {
    expect(countWorkingDaysBetween(MON, NEXT_MON)).toBe(5);
  });

  it('Mon -> next Tue = 6 working days', () => {
    expect(countWorkingDaysBetween(MON, NEXT_TUE)).toBe(6);
  });

  it('Fri -> next Fri = 5 working days, spanning two weekends', () => {
    expect(countWorkingDaysBetween(FRI, NEXT_FRI)).toBe(5);
  });

  it('a Saturday or Sunday toDate never counts itself', () => {
    expect(countWorkingDaysBetween(FRI, SAT)).toBe(0);
    expect(countWorkingDaysBetween(FRI, SUN)).toBe(0);
  });
});

describe('isUrgentShipment', () => {
  it('is urgent when shipment date is the same day', () => {
    expect(isUrgentShipment(MON, MON)).toBe(true);
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

  it('is urgent when fewer than 5 working days away (Mon -> Fri, 4 days)', () => {
    expect(isUrgentShipment(MON, FRI)).toBe(true);
  });

  it('is NOT urgent at exactly 5 working days away (Mon -> next Mon)', () => {
    expect(isUrgentShipment(MON, NEXT_MON)).toBe(false);
  });

  it('is NOT urgent when more than 5 working days away (Mon -> next Tue)', () => {
    expect(isUrgentShipment(MON, NEXT_TUE)).toBe(false);
  });

  it('is urgent one working day short of the 5-day boundary (Tue -> next Mon = 4 days)', () => {
    expect(isUrgentShipment(TUE, NEXT_MON)).toBe(true);
  });

  it('returns false when either date is missing', () => {
    expect(isUrgentShipment(null, MON)).toBe(false);
    expect(isUrgentShipment(MON, null)).toBe(false);
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
