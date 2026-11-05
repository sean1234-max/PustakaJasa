import { describe, it, expect } from 'vitest';
import { proposeChanges, orderPlaquesText, askedDay } from './order.ts';

const order = (over = {}) => ({
  id: 'ORD-0233', sekolah: 'SK SRI SERDANG', status: 'Salesman Approved',
  shipment_date: '2026-11-16T16:00:00.000Z', function_date: '2026-11-24T16:00:00.000Z', remark: 'OLD NOTE', ...over,
});

describe('proposeChanges', () => {
  it('proposes a new Shipment Date, from its Malaysian day', () => {
    expect(proposeChanges(order(), { shipmentDate: '2026-11-19' }))
      .toEqual({ changes: [{ field: 'shipmentDate', from: '2026-11-17', to: '2026-11-19' }], refused: [] });
  });

  it('proposes nothing when the date is already that', () => {
    expect(proposeChanges(order(), { shipmentDate: '2026-11-17' }).changes).toEqual([]);
  });

  it('adds to the Remark rather than replacing it', () => {
    expect(proposeChanges(order(), { remarkAdd: 'Salesman hantar sendiri' }).changes)
      .toEqual([{ field: 'remark', from: 'OLD NOTE', to: 'OLD NOTE\nSalesman hantar sendiri' }]);
  });

  it('refuses a Shipment Date once the order is past production', () => {
    const out = proposeChanges(order({ status: 'Completed' }), { shipmentDate: '2026-11-19' });
    expect(out.changes).toEqual([]);
    expect(out.refused[0]).toContain('Completed');
  });

  it('refuses something that is not a date', () => {
    expect(proposeChanges(order(), { functionDate: 'next week' }).refused[0]).toContain('isn\'t a date');
  });
});

describe('orderPlaquesText', () => {
  it('lists totals and each distinct plaque with its count', () => {
    const items = [{
      id: 'i1', categoryKey: 'UMUM', categoryLabel: 'ORDER LAIN-LAIN', blockIdx: 0, jenisPlak: 'PKF 265', qty: 2,
      detail: { lines: { 'UMUM::0::0': 'MAJLIS ANUGERAH 2026', 'UMUM::0::1': 'JOHAN' }, rows: [{ id: 'r1', qty: 2 }] },
    }];
    const text = orderPlaquesText(items);
    expect(text).toContain('- PKF 265: 2');
    expect(text).toMatch(/ORDER LAIN-LAIN \| PKF 265 \| .*JOHAN.* × 2/);
  });
});

describe('askedDay', () => {
  const today = '2026-11-05';
  it.each([
    ['Give me of summary list that all order placed on 4th November 2026', '2026-11-04'],
    ['summary 4/11', '2026-11-04'],
    ['summary 4/11/26', '2026-11-04'],
    ['summary 2026-11-04', '2026-11-04'],
    ['summary Nov 4', '2026-11-04'],
    ['senarai 4 Ogos', '2026-08-04'],
    ['senarai 1 Mac', '2026-03-01'],
    ['summary today', '2026-11-05'],
    ['summary yesterday', '2026-11-04'],
    ['summary 31/2', ''],
    ['summary please', ''],
  ])('%s → %s', (text, day) => {
    expect(askedDay(text, today)).toBe(day);
  });
});
