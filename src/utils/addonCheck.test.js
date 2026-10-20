import { describe, expect, it } from 'vitest';
import { addonRepeatsOrder } from './addonCheck';

const I = (categoryKey, jenisPlak, qty) => ({ categoryKey, jenisPlak, qty });
const order = [I('TOKOH_SHEET', 'PK 261 / A', 2), I('TOKOH_SHEET', 'PK 261 / A', 2), I('UMUM', 'CPH / B', 72), I('UMUM', 'CPH / A', 36)];

describe('addonRepeatsOrder', () => {
  it('flags the original order uploaded again', () => {
    expect(addonRepeatsOrder(order.map((it) => ({ ...it })), order)).toEqual({ matched: 4, total: 4 });
  });

  it('leaves a real Tambahan alone, even one repeating a single item', () => {
    expect(addonRepeatsOrder([I('TOKOH_SHEET', 'PK 261 / A', 2)], order)).toBeNull();
    expect(addonRepeatsOrder([I('UMUM', 'CPH / C', 5)], order)).toBeNull();
  });

  it('counts each order item once', () => {
    const twice = [I('UMUM', 'CPH / B', 72), I('UMUM', 'CPH / B', 72)];
    expect(addonRepeatsOrder(twice, [I('UMUM', 'CPH / B', 72)])).toBeNull();
  });
});
