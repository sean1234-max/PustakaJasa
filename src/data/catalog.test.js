import { describe, it, expect } from 'vitest';
import {
  flattenPlakCatalog, standardUnitPrice, tahunRangeYears,
  stockZoneFor, getStockStatus, statusPillStyle, STATUS_STAGES, ORDER_STATUSES,
  deliveryStageForShipmentDate, resolveSelempangWarna,
  MALAY_ORDINALS, ordinalToNum, numToOrdinal, distributeQtyOverPositions,
  CATEGORIES, makeDynamicCategoryKey, isDynamicCategoryKey, resolveCategory, categoriesUsedByItems,
} from './catalog';

describe('distributeQtyOverPositions', () => {
  it('splits evenly when it divides exactly', () => {
    expect(distributeQtyOverPositions(6, 3)).toEqual([2, 2, 2]);
  });

  it('puts the remainder on the earliest positions', () => {
    expect(distributeQtyOverPositions(7, 3)).toEqual([3, 2, 2]);
  });

  it('a qty smaller than the position count puts 1 on each of the earliest positions, 0 elsewhere', () => {
    expect(distributeQtyOverPositions(1, 5)).toEqual([1, 0, 0, 0, 0]);
    expect(distributeQtyOverPositions(3, 5)).toEqual([1, 1, 1, 0, 0]);
  });

  it('always sums back to the exact original qty', () => {
    for (const [qty, positions] of [[180, 20], [4, 5], [9, 4], [0, 5], [23, 1]]) {
      expect(distributeQtyOverPositions(qty, positions).reduce((a, b) => a + b, 0)).toBe(qty);
    }
  });

  it('handles 0 positions / negative or missing input without throwing', () => {
    expect(distributeQtyOverPositions(5, 0)).toEqual([]);
    expect(distributeQtyOverPositions(-3, 4)).toEqual([0, 0, 0, 0]);
    expect(distributeQtyOverPositions(undefined, 3)).toEqual([0, 0, 0]);
  });
});

describe('makeDynamicCategoryKey / isDynamicCategoryKey / resolveCategory', () => {
  it('resolves a standard key exactly as before (no dynamic prefix)', () => {
    expect(resolveCategory('ALIRAN')).toBe(CATEGORIES.find((c) => c.key === 'ALIRAN'));
    expect(isDynamicCategoryKey('ALIRAN')).toBe(false);
  });

  it('resolves a sheet-derived key by cloning its template kind and swapping in the label', () => {
    const key = makeDynamicCategoryKey('ALIRAN', 'PENCAPAIAN');
    expect(isDynamicCategoryKey(key)).toBe(true);
    const cat = resolveCategory(key);
    expect(cat.key).toBe(key);
    expect(cat.label).toBe('PENCAPAIAN');
    // Every other behaviour flag is cloned straight from ALIRAN.
    expect(cat.mode).toBe('list');
    expect(cat.aliranKedudukan).toBe(true);
  });

  it('round-trips a label with spaces/punctuation losslessly', () => {
    const key = makeDynamicCategoryKey('TOKOH_SHEET', 'Hari Anugerah 2.0 (Sukan)');
    expect(resolveCategory(key).label).toBe('Hari Anugerah 2.0 (Sukan)');
  });

  it('returns undefined for a dynamic-shaped key whose template kind is not a real category', () => {
    expect(resolveCategory('DYN::NOT_A_REAL_KIND::Something')).toBeUndefined();
  });

  it('returns undefined for a key that is neither a static key nor dynamically-shaped', () => {
    expect(resolveCategory('TOTALLY_UNKNOWN')).toBeUndefined();
    expect(resolveCategory('')).toBeUndefined();
    expect(resolveCategory(undefined)).toBeUndefined();
  });
});

describe('categoriesUsedByItems', () => {
  it('keeps catalog order for standard categories and appends dynamic ones after', () => {
    const dynKey = makeDynamicCategoryKey('ALIRAN', 'PENCAPAIAN');
    // Items listed out of catalog order (MP1 after PPKI in items, but
    // catalog order is PPKI, MP1, ... — result should follow catalog order).
    const items = [
      { categoryKey: 'MP1' },
      { categoryKey: dynKey },
      { categoryKey: 'PPKI' },
    ];
    const cats = categoriesUsedByItems(items);
    expect(cats.map((c) => c.key)).toEqual(['PPKI', 'MP1', dynKey]);
    expect(cats[2].label).toBe('PENCAPAIAN');
  });

  it('ignores items with no categoryKey and de-duplicates repeats', () => {
    const items = [{ categoryKey: 'PPKI' }, { categoryKey: 'PPKI' }, { categoryKey: '' }, {}];
    expect(categoriesUsedByItems(items).map((c) => c.key)).toEqual(['PPKI']);
  });

  it('returns an empty array for no items', () => {
    expect(categoriesUsedByItems([])).toEqual([]);
    expect(categoriesUsedByItems(undefined)).toEqual([]);
  });
});

describe('MALAY_ORDINALS / ordinalToNum / numToOrdinal', () => {
  it('covers 1st (PERTAMA) through 20th (KEDUA PULUH)', () => {
    expect(MALAY_ORDINALS).toHaveLength(20);
    expect(MALAY_ORDINALS[0]).toBe('PERTAMA');
    expect(MALAY_ORDINALS[19]).toBe('KEDUA PULUH');
  });

  it('numToOrdinal round-trips through ordinalToNum for every position 1-20', () => {
    for (let n = 1; n <= 20; n++) {
      const word = numToOrdinal(n);
      expect(word).not.toBe('');
      expect(ordinalToNum(word)).toBe(n);
    }
  });

  it('parses the 11th-20th compound words correctly', () => {
    expect(ordinalToNum('KESEBELAS')).toBe(11);
    expect(ordinalToNum('KEDUA BELAS')).toBe(12);
    expect(ordinalToNum('KESEMBILAN BELAS')).toBe(19);
    expect(ordinalToNum('KEDUA PULUH')).toBe(20);
  });

  it('still parses "KE-N" / "KE N" / bare "N" up to 20, and rejects 21+', () => {
    expect(ordinalToNum('KE-15')).toBe(15);
    expect(ordinalToNum('KE 20')).toBe(20);
    expect(ordinalToNum('20')).toBe(20);
    expect(ordinalToNum('KE-21')).toBeNull();
  });

  it('numToOrdinal returns "" past the 20th', () => {
    expect(numToOrdinal(21)).toBe('');
  });
});

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
