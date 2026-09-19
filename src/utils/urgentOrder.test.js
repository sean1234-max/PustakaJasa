import { describe, it, expect } from 'vitest';
import { countWorkingDaysBetween, isUrgentShipment } from './urgentOrder';

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
