import { describe, it, expect } from 'vitest';
import { crystalRowsOf, reservedCrystalsOf } from './CrystalPreview';

describe('crystalRowsOf — the Crystal Preview gets only the order\'s crystal rows', () => {
  const tokoh = (id, jenisPlak, desc) => ({
    id, jenisPlak, qty: 1, categoryKey: 'TOKOH', blockIdx: 0,
    detail: {
      lines: { 'TOKOH::0::0': 'HARI ANUGERAH 2026', 'TOKOH::0::1': '', 'TOKOH::0::2': '' },
      rows: [{ id: 1, desc, qty: 1 }],
    },
  });
  const order = {
    id: 'ORD-1', schoolLanguage: 'SK',
    items: [tokoh('a', 'CPH / A', 'TOKOH MURID'), tokoh('b', 'CRYSTAL / AK7 / DESIGN C', 'TOKOH NILAM')],
  };

  it('keeps "CRYSTAL / …" rows, as named columns, and leaves ordinary plaques out', () => {
    const rows = crystalRowsOf(order);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ event_header: 'HARI ANUGERAH 2026', position: 'TOKOH NILAM', jenis_plak: 'CRYSTAL / AK7 / DESIGN C' });
  });

  it('gives nothing for an order without crystals, or no order', () => {
    expect(crystalRowsOf({ ...order, items: [order.items[0]] })).toEqual([]);
    expect(crystalRowsOf(null)).toEqual([]);
  });

  it('lists the crystals still Reserved (no name yet), which the preview leaves out', () => {
    const reservedItem = {
      id: 'r', jenisPlak: 'CRYSTAL / SA4 / DESIGN C', qty: 1, categoryKey: 'TOKOH_SHEET', blockIdx: 0,
      detail: { lines: { 'TOKOH_SHEET::0::0': 'HARI ANUGERAH 2026' }, rows: [{ id: 1, desc: 'TOKOH AKADEMIK', qty: 1, namaMurid: 'RESERVE' }] },
    };
    const withReserved = { ...order, items: [...order.items, reservedItem] };
    expect(reservedCrystalsOf(withReserved)).toEqual(['SA4 / DESIGN C (1)']);
    expect(crystalRowsOf(withReserved)).toHaveLength(1);
  });
});
