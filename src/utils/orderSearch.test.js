import { describe, it, expect } from 'vitest';
import { matchesOrderSearch } from './orderSearch';

const order = {
  id: 'ORD-0023', sekolah: 'SK SG SERAI KUANG', invoiceId: 'INV-1001',
  invoiceGroups: [{ invoiceId: 'INV-2002', jenisPlak: ['PKC 246'] }],
};

describe('matchesOrderSearch', () => {
  it('matches part of the school name, any case and spacing', () => {
    expect(matchesOrderSearch(order, 'sk  sg serai')).toBe(true);
    expect(matchesOrderSearch(order, 'kuang')).toBe(true);
  });

  it('matches the order ID and the invoice numbers, including a split invoice', () => {
    expect(matchesOrderSearch(order, '0023')).toBe(true);
    expect(matchesOrderSearch(order, 'inv-1001')).toBe(true);
    expect(matchesOrderSearch(order, '2002')).toBe(true);
  });

  it('matches nothing for a blank query or another school', () => {
    expect(matchesOrderSearch(order, '   ')).toBe(false);
    expect(matchesOrderSearch(order, 'SK SUNGAI')).toBe(false);
    expect(matchesOrderSearch({ id: 'ORD-0001', sekolah: null, invoiceId: null }, 'SK')).toBe(false);
  });
});
