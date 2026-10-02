import { describe, it, expect } from 'vitest';
import {
  flattenPlakCatalog, standardUnitPrice, tahunRangeYears,
  stockZoneFor, getStockStatus, statusPillStyle, STATUS_STAGES, ORDER_STATUSES,
  deliveryStageForShipmentDate, resolveSelempangWarna,
  MALAY_ORDINALS, ordinalToNum, numToOrdinal,
  CATEGORIES, makeDynamicCategoryKey, isDynamicCategoryKey, resolveCategory, categoriesUsedByItems,
  filterHiddenPlakCatalog, getLowStockAlerts,
  parseDisplayDate, defaultShipmentDate, toMalaysiaDay, malaysiaDayIso,
} from './catalog';

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

describe('filterHiddenPlakCatalog — auto-hide at the low-stock ratio', () => {
  it('hides a leaf at or below 20% of its baseline, keeps one above it', () => {
    const tree = [
      { code: 'A', stockQty: 200, stockBaseline: 1000 }, // 20% -> hidden
      { code: 'B', stockQty: 210, stockBaseline: 1000 }, // 21% -> kept
    ];
    const codes = filterHiddenPlakCatalog(tree).map((n) => n.code);
    expect(codes).toEqual(['B']);
  });

  it('a code with no baseline only hides at literal 0, same as before', () => {
    const tree = [
      { code: 'A', stockQty: 1 }, // no baseline: only 0 hides it
      { code: 'B', stockQty: 0 },
    ];
    const codes = filterHiddenPlakCatalog(tree).map((n) => n.code);
    expect(codes).toEqual(['A']);
  });

  it('a low-stock parent hides every variant beneath it, not just a matching leaf', () => {
    const tree = [
      {
        code: 'GOLD', stockQty: 100, stockBaseline: 1000, children: [
          { code: 'BASE A', stockQty: 500, stockBaseline: 1000 },
        ],
      },
    ];
    expect(filterHiddenPlakCatalog(tree)).toEqual([]);
  });
});

describe('getLowStockAlerts', () => {
  it('flags a code at or below 40% and marks whether it is already hidden', () => {
    const tree = [
      { code: 'OK', stockQty: 500, stockBaseline: 1000 }, // 50% -> not flagged
      { code: 'LOW', stockQty: 300, stockBaseline: 1000 }, // 30% -> flagged, not hidden
      { code: 'GONE', stockQty: 100, stockBaseline: 1000 }, // 10% -> flagged, hidden
    ];
    const alerts = getLowStockAlerts(tree);
    expect(alerts.map((a) => a.path)).toEqual(['GONE', 'LOW']); // worst first
    expect(alerts.find((a) => a.path === 'LOW').hidden).toBe(false);
    expect(alerts.find((a) => a.path === 'GONE').hidden).toBe(true);
  });

  it('reports a Stock-Group-shared code once, not once per linked variant', () => {
    const tree = [
      { code: 'GOLD', children: [{ id: 'g1', code: 'BASE A', stockQty: 200, stockBaseline: 1000, stockGroupKey: 'BASE A', stockGroupSize: 2 }] },
      { code: 'SILVER', children: [{ id: 's1', code: 'BASE A', stockQty: 200, stockBaseline: 1000, stockGroupKey: 'BASE A', stockGroupSize: 2 }] },
    ];
    const alerts = getLowStockAlerts(tree);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].label).toBe('BASE A');
    expect(alerts[0].sharedWith).toBe(1);
  });

  it('ignores untracked codes', () => {
    expect(getLowStockAlerts([{ code: 'X' }])).toEqual([]);
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
  // shipmentDate reaches this function as the stored string — a picked day
  // saved as its Malaysian midnight (malaysiaDayIso); build the fixtures the
  // same way so the test doesn't depend on the runner's timezone.
  const shipISO = (y, m, d) => malaysiaDayIso(new Date(y, m, d));

  it('is Waiting for Shipment when the Shipment Date is still ahead', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 12), today)).toBe('Waiting for Shipment');
  });
  it('is Shipped on the Shipment Date itself', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 10), today)).toBe('Shipped');
  });
  it('is Completed once the Shipment Date has passed', () => {
    expect(deliveryStageForShipmentDate(shipISO(2026, 8, 9), today)).toBe('Completed');
  });
  it('falls back to Waiting for Shipment for a missing or unparseable date', () => {
    expect(deliveryStageForShipmentDate(null, today)).toBe('Waiting for Shipment');
    expect(deliveryStageForShipmentDate('TBD', today)).toBe('Waiting for Shipment');
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

describe('defaultShipmentDate — Sales\' Shipment Date starts a week after the order was placed', () => {
  const day = (y, m, d) => new Date(y, m - 1, d);

  it('reads formatDate\'s own "02 Oct 2026"', () => {
    expect(parseDisplayDate('02 Oct 2026')).toEqual(day(2026, 10, 2));
    expect(parseDisplayDate('not a date')).toBeNull();
  });

  it('placed 2 Oct → 9 Oct', () => {
    expect(defaultShipmentDate('02 Oct 2026', day(2026, 10, 2), null)).toEqual(day(2026, 10, 9));
  });

  it('never before today (an order approved long after it was placed)', () => {
    expect(defaultShipmentDate('02 Oct 2026', day(2026, 10, 20), null)).toEqual(day(2026, 10, 20));
  });

  it('never after the Function Date', () => {
    expect(defaultShipmentDate('02 Oct 2026', day(2026, 10, 2), day(2026, 10, 6))).toEqual(day(2026, 10, 6));
  });

  it('no readable placed date → a week from today', () => {
    expect(defaultShipmentDate('', day(2026, 10, 2), null)).toEqual(day(2026, 10, 9));
  });
});

describe('Malaysia dates — the project always runs on Asia/Kuala_Lumpur', () => {
  const day = (y, m, d) => new Date(y, m - 1, d);

  it('a stored timestamp reads back as its Malaysian day (old UTC-saved and new +08:00 forms)', () => {
    expect(toMalaysiaDay('2026-10-08T16:00:00.000Z')).toEqual(day(2026, 10, 9));
    expect(toMalaysiaDay('2026-10-09T00:00:00+08:00')).toEqual(day(2026, 10, 9));
    expect(toMalaysiaDay('2026-10-09T15:59:00Z')).toEqual(day(2026, 10, 9));
    expect(toMalaysiaDay('2026-10-09T16:00:00Z')).toEqual(day(2026, 10, 10));
    expect(toMalaysiaDay('')).toBeNull();
  });

  it('a picked day is saved as that day\'s Malaysian midnight, and reads back the same', () => {
    expect(malaysiaDayIso(day(2026, 10, 9))).toBe('2026-10-09T00:00:00+08:00');
    expect(toMalaysiaDay(malaysiaDayIso(day(2026, 10, 9)))).toEqual(day(2026, 10, 9));
  });

  it('Shipped/Completed follow the Malaysian day of the Shipment Date', () => {
    expect(deliveryStageForShipmentDate('2026-10-08T16:00:00.000Z', day(2026, 10, 9))).toBe('Shipped');
    expect(deliveryStageForShipmentDate('2026-10-09T00:00:00+08:00', day(2026, 10, 8))).toBe('Waiting for Shipment');
    expect(deliveryStageForShipmentDate('2026-10-09T00:00:00+08:00', day(2026, 10, 10))).toBe('Completed');
  });
});
