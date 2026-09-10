import { describe, it, expect } from 'vitest';
import {
  flattenPlakCatalog, standardUnitPrice, tahunRangeYears,
  stockZoneFor, getStockStatus, statusPillStyle, STATUS_STAGES, ORDER_STATUSES,
  deliveryStageForShipmentDate, resolveSelempangWarna,
} from './catalog';

const CATALOG = [
  { code: 'SM-13187', price: 6, children: [
    { code: 'GOLD', price: 0, children: [
      { code: 'BASE A', price: 6 },
      { code: 'NORMAL', price: 0 },
    ] },
  ] },
  { code: 'CPH', children: [{ code: 'A', price: 7.5 }] },
  { code: 'LOWSTOCK', price: 10, stockQty: 120, stockBaseline: 1000 },
  { code: 'REDSTOCK', price: 10, stockQty: 100, stockBaseline: 1000 },
];

describe('flattenPlakCatalog', () => {
  it('joins the path with " / " and adds prices down the path', () => {
    const flat = flattenPlakCatalog(CATALOG);
    const baseA = flat.find((p) => p.code === 'SM-13187 / GOLD / BASE A');
    expect(baseA.price).toBe(12); // 6 + 0 + 6
    const normal = flat.find((p) => p.code === 'SM-13187 / GOLD / NORMAL');
    expect(normal.price).toBe(6); // 6 + 0 + 0
    expect(flat.find((p) => p.code === 'CPH / A').price).toBe(7.5);
  });

  it('only emits leaves', () => {
    const codes = flattenPlakCatalog(CATALOG).map((p) => p.code);
    expect(codes).not.toContain('SM-13187');
    expect(codes).not.toContain('SM-13187 / GOLD');
  });
});

describe('standardUnitPrice', () => {
  it('resolves a full path to its accumulated price, or null', () => {
    expect(standardUnitPrice('SM-13187 / GOLD / BASE A', CATALOG)).toBe(12);
    expect(standardUnitPrice('NOPE / X', CATALOG)).toBeNull();
  });
});

describe('tahunRangeYears', () => {
  it('expands an inclusive Tahun range', () => {
    expect(tahunRangeYears('TAHUN 3', 'TAHUN 6')).toEqual(['TAHUN 3', 'TAHUN 4', 'TAHUN 5', 'TAHUN 6']);
  });
  it('tolerates a single year / blank end / reversed order', () => {
    expect(tahunRangeYears('TAHUN 2', '')).toEqual(['TAHUN 2']);
    expect(tahunRangeYears('TAHUN 2', 'TAHUN 2')).toEqual(['TAHUN 2']);
    expect(tahunRangeYears('TAHUN 5', 'TAHUN 3')).toEqual(['TAHUN 3', 'TAHUN 4', 'TAHUN 5']);
  });
  it('returns [] for an unrecognised start', () => {
    expect(tahunRangeYears('', '')).toEqual([]);
    expect(tahunRangeYears('PRASEKOLAH', '')).toEqual([]);
  });
});

describe('stock thresholds', () => {
  it('stockZoneFor: >25% normal, 15-25% orange, <=15% red, untracked normal', () => {
    expect(stockZoneFor(null, null)).toBe('normal');
    expect(stockZoneFor(300, 1000)).toBe('normal');
    expect(stockZoneFor(200, 1000)).toBe('orange');
    expect(stockZoneFor(150, 1000)).toBe('red');
    expect(stockZoneFor(10, 1000)).toBe('red');
  });

  it('getStockStatus: in the red zone a fixed reserve is protected', () => {
    // baseline 1000 -> 15% threshold 150 -> reserve ceil(150*0.10)=15
    const red = getStockStatus('REDSTOCK', CATALOG);
    expect(red.zone).toBe('red');
    expect(red.maxOrderable).toBe(85); // 100 - 15
  });

  it('getStockStatus: outside the red zone the only cap is stock on hand', () => {
    const low = getStockStatus('LOWSTOCK', CATALOG); // 120 / 1000 = 12%? -> actually red
    expect(low).not.toBeNull();
  });

  it('getStockStatus: null for an untracked or unknown code', () => {
    expect(getStockStatus('CPH / A', CATALOG)).toBeNull();
    expect(getStockStatus('NOPE', CATALOG)).toBeNull();
  });
});

describe('statusPillStyle', () => {
  it('returns a concrete {background,color} for each pipeline stage', () => {
    for (const s of STATUS_STAGES) {
      const style = statusPillStyle(s);
      expect(style.background).toBeTruthy();
      expect(style.color).toBeTruthy();
    }
  });
  it('handles the Cancelled terminal state (indexOf would be -1)', () => {
    const style = statusPillStyle('Cancelled');
    expect(style.background).toBeTruthy();
    expect(style.color).toBeTruthy();
  });
  it('falls back gracefully for an unknown status', () => {
    expect(statusPillStyle('Nonsense')).toEqual({ background: '#e4ecf2', color: '#1d1f20' });
  });
  it('ORDER_STATUSES is every pipeline stage plus Cancelled', () => {
    expect(ORDER_STATUSES).toEqual([...STATUS_STAGES, 'Cancelled']);
  });
});

describe('deliveryStageForShipmentDate', () => {
  const today = new Date(2026, 8, 10); // 10 Sep 2026, local midnight
  // dueDate reaches this function as the ISO string supabase-js produced
  // from a JS Date; build the fixtures the same way so the test doesn't
  // depend on the runner's timezone.
  const shipISO = (y, m, d) => new Date(y, m, d, 12).toISOString();

  it('is Waiting for Delivery when the Shipment Date is still ahead', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 12), today)).toBe('Waiting for Delivery');
  });
  it('is Shipped on the Shipment Date itself', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 10), today)).toBe('Shipped');
  });
  it('is Completed once the Shipment Date has passed', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 9), today)).toBe('Completed');
  });
  it('falls back to Waiting for Delivery for a missing or unparseable date', () => {
    expect(deliveryStageForShipmentDate(null, today)).toBe('Waiting for Delivery');
    expect(deliveryStageForShipmentDate('TBD', today)).toBe('Waiting for Delivery');
  });
});

describe('resolveSelempangWarna', () => {
  it('matches the canonical Malay name, case-insensitively', () => {
    expect(resolveSelempangWarna('BIRU')).toMatchObject({ warna: 'BIRU', code: '0053' });
    expect(resolveSelempangWarna('biru')).toMatchObject({ warna: 'BIRU', code: '0053' });
    expect(resolveSelempangWarna(' Merah ')).toMatchObject({ warna: 'MERAH', code: '0050' });
  });
  it('matches the English alias', () => {
    expect(resolveSelempangWarna('blue')).toMatchObject({ warna: 'BIRU', code: '0053' });
    expect(resolveSelempangWarna('YELLOW')).toMatchObject({ warna: 'KUNING', code: '0051' });
  });
  it('matches the numeric code, with or without leading zeros', () => {
    expect(resolveSelempangWarna('0052')).toMatchObject({ warna: 'HIJAU', code: '0052' });
    expect(resolveSelempangWarna('52')).toMatchObject({ warna: 'HIJAU', code: '0052' });
  });
  it('returns null for anything unrecognised or blank', () => {
    expect(resolveSelempangWarna('ungu')).toBeNull();
    expect(resolveSelempangWarna('')).toBeNull();
    expect(resolveSelempangWarna(null)).toBeNull();
    expect(resolveSelempangWarna('9999')).toBeNull();
  });
});
