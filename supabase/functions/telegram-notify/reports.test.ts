import { describe, it, expect } from 'vitest';
import { problemsOf } from './reports.ts';

const NOW = Date.parse('2026-11-05T10:00:00+08:00');
const order = (over = {}) => ({ id: 'ORD-0300', sekolah: 'SK X', sales: 'ALI', status: 'In Production', reviewed_at: null, shipment_date: '2026-11-20T00:00:00+08:00', ...over });
const keys = (orders: Record<string, unknown>[]) => problemsOf(orders, '2026-11-05', NOW).map((p) => p.key);

describe('problemsOf', () => {
  it('asks about an order past its Shipment Date that is not Completed', () => {
    expect(keys([order({ shipment_date: '2026-11-03T00:00:00+08:00' })])).toEqual(['ask:late:ORD-0300:2026-11-03']);
  });

  it('asks when it ships today or tomorrow but is not approved yet', () => {
    expect(keys([order({ status: 'Salesman Approved', shipment_date: '2026-11-06T00:00:00+08:00' })])).toEqual(['ask:soon:ORD-0300:2026-11-06']);
    expect(keys([order({ shipment_date: '2026-11-06T00:00:00+08:00' })])).toEqual([]); // In Production is fine
  });

  it('asks when the salesman has not approved for more than 2 days', () => {
    expect(keys([order({ status: 'Reviewing Order', reviewed_at: '2026-11-02T09:00:00+08:00' })])).toEqual(['ask:stuck:ORD-0300']);
    expect(keys([order({ status: 'Reviewing Order', reviewed_at: '2026-11-04T09:00:00+08:00' })])).toEqual([]);
  });

  it('says nothing about an order on track', () => {
    expect(keys([order(), order({ shipment_date: null })])).toEqual([]);
  });
});
