import { describe, it, expect } from 'vitest';
import { buildCategoryCartItems } from './categoryCartItems';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';

// Minimal draft — buildCategoryCartItems only reads these fields.
const draft = (selempangRows) => ({
  lineValues: {},
  matrixValues: {},
  rowsByBlock: { 'SELEMPANG::0': selempangRows },
  plakRows: {},
  columnsByBlock: {},
  plakCatalog: [{ code: 'SELEMPANG', price: 40 }],
  schoolLanguage: 'SK',
});

describe('buildCategoryCartItems — SELEMPANG', () => {
  it('builds one combined item priced at RM40 each, colours normalised', () => {
    const res = buildCategoryCartItems(draft([
      { id: 1, acara: 'Hari Sukan 2026', warna: 'biru', qty: '20' },
      { id: 2, acara: 'Hari Sukan 2026', warna: '0050', qty: '10' },
    ]), 'SELEMPANG');
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(1);
    const [it] = res.items;
    expect(it).toMatchObject({ jenisPlak: 'SELEMPANG', qty: 30, unitPrice: 40, harga: 1200, categoryKey: 'SELEMPANG' });
    expect(it.detail.rows).toEqual([
      { id: 1, acara: 'Hari Sukan 2026', warna: 'BIRU', warnaCode: '0053', qty: '20' },
      { id: 2, acara: 'Hari Sukan 2026', warna: 'MERAH', warnaCode: '0050', qty: '10' },
    ]);
  });

  it('is not engaged when every row is blank', () => {
    const res = buildCategoryCartItems(draft([{ id: 1, acara: '', warna: '', qty: '' }]), 'SELEMPANG');
    expect(res).toEqual({ engaged: false });
  });

  it('blocks on an unrecognised colour', () => {
    const res = buildCategoryCartItems(draft([{ id: 1, acara: 'Hari Kantin', warna: 'ungu', qty: '5' }]), 'SELEMPANG');
    expect(res.items).toBeUndefined();
    expect(res.error).toMatch(/ungu/);
  });

  it('blocks on a missing ACARA or a zero quantity', () => {
    expect(buildCategoryCartItems(draft([{ id: 1, acara: '', warna: 'BIRU', qty: '5' }]), 'SELEMPANG').error).toMatch(/ACARA/);
    expect(buildCategoryCartItems(draft([{ id: 1, acara: 'X', warna: 'BIRU', qty: '0' }]), 'SELEMPANG').error).toMatch(/kuantiti/i);
  });

  it('falls back to RM40 when the catalog node is not seeded yet', () => {
    const d = draft([{ id: 1, acara: 'X', warna: 'BIRU', qty: '3' }]);
    d.plakCatalog = [];
    const res = buildCategoryCartItems(d, 'SELEMPANG');
    expect(res.items[0]).toMatchObject({ unitPrice: 40, harga: 120 });
  });

  it('round-trips through an order and back into a read-only block', () => {
    const { items } = buildCategoryCartItems(draft([
      { id: 1, acara: 'Hari Sukan 2026', warna: 'biru', qty: '20' },
      { id: 2, acara: 'Hari Sukan 2026', warna: 'merah', qty: '10' },
    ]), 'SELEMPANG');
    const order = { schoolLanguage: 'SK', items };
    const { blocks } = reconstructBlocksForCategory(order, 'SELEMPANG', [{ code: 'SELEMPANG', price: 40 }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ selempang: true, section: 'selempang', blockTotalQty: 30 });
    expect(blocks[0].rows.map((r) => [r.acara, r.warnaResolved?.warna, r.qty])).toEqual([
      ['Hari Sukan 2026', 'BIRU', '20'],
      ['Hari Sukan 2026', 'MERAH', '10'],
    ]);
  });
});

// TOKOH_SHEET (and LONJAKAN/KEHADIRAN — same plakPerRow shape): each row is
// its own cart item, priced on its own. The item's own top-level jenisPlak/
// unitPrice were always right (that's what order totals/CSV read), but the
// row snapshot fed back into every read-only view (Order Details, print,
// Store Admin, Production) used to omit them — see categoryCartItems.js.
describe('buildCategoryCartItems — TOKOH_SHEET (plakPerRow)', () => {
  const draftTokoh = (rows) => ({
    // requiredLineIndices [0, 2] (catalog.js's TOKOH_SHEET) — TAJUK BESAR +
    // ACARA must be filled before any row is checked.
    lineValues: { 'TOKOH_SHEET::0::0': 'Majlis Anugerah', 'TOKOH_SHEET::0::2': 'TOKOH MURID' },
    matrixValues: {},
    rowsByBlock: { 'TOKOH_SHEET::0': rows },
    plakRows: {},
    columnsByBlock: {},
    plakCatalog: [{ code: 'MP399', price: 12 }],
    schoolLanguage: 'SK',
  });

  it('snapshots jenisPlak + unitPrice onto the row detail, not just the item', () => {
    const res = buildCategoryCartItems(draftTokoh([
      { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
    ]), 'TOKOH_SHEET');
    expect(res.error).toBeUndefined();
    expect(res.items).toHaveLength(1);
    const [it] = res.items;
    expect(it).toMatchObject({ jenisPlak: 'MP399', unitPrice: 12, harga: 12 });
    expect(it.detail.rows[0]).toMatchObject({ desc: 'TOKOH MURID', jenisPlak: 'MP399', unitPrice: 12, namaMurid: 'Ali' });
  });

  // Regression: catalog.js's hideQtyLabelSuffix (set on every plakPerRow
  // category — ALIRAN/LONJAKAN/KEHADIRAN/TOKOH_SHEET/SELEMPANG) blanks
  // computeBlocks.js's qtyLabel to drop the "Kuantiti — X" heading's OWN
  // suffix — it was also feeding categoryLabel here, silently blanking
  // the Category column on PriceTable (and anything else reading
  // item.categoryLabel directly) for every one of these categories.
  it('stamps the real category label (TOKOH), not the blank hideQtyLabelSuffix qtyLabel', () => {
    const res = buildCategoryCartItems(draftTokoh([
      { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
    ]), 'TOKOH_SHEET');
    expect(res.items[0].categoryLabel).toBe('TOKOH');
  });

  it('round-trips through an order and back into a read-only block with Jenis Plak + Harga intact', () => {
    const { items } = buildCategoryCartItems(draftTokoh([
      { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
      { id: 2, desc: 'TOKOH NILAM', qty: '1', jenisPlak: 'MP399', namaMurid: 'Siti' },
    ]), 'TOKOH_SHEET');
    const order = { schoolLanguage: 'SK', items };
    const { blocks } = reconstructBlocksForCategory(order, 'TOKOH_SHEET', [{ code: 'MP399', price: 12 }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].rows.map((r) => [r.desc, r.jenisPlak, r.hargaLabel])).toEqual([
      ['TOKOH MURID', 'MP399', 'RM 12.00'],
      ['TOKOH NILAM', 'MP399', 'RM 12.00'],
    ]);
  });

  // Regression: two different honourees can share the same TOKOH award name
  // (e.g. 正班长 given to one student per class, many classes) — desc is NOT
  // a unique row identity here the way it is for LONJAKAN/KEHADIRAN's fixed
  // TAHUN rows. Summing by desc silently merged every honoree sharing an
  // award into one row (qty summed, every name but the first dropped) —
  // see computeBlocks.js's mergeItemDetailIntoMaps.
  it('keeps every honoree as its own row even when they share the same award name', () => {
    const { items } = buildCategoryCartItems(draftTokoh([
      { id: 1, desc: '正班长', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali 1B' },
      { id: 2, desc: '正班长', qty: '1', jenisPlak: 'MP399', namaMurid: 'Siti 1H' },
      { id: 3, desc: '正班长', qty: '1', jenisPlak: 'MP399', namaMurid: 'Wei 1J' },
    ]), 'TOKOH_SHEET');
    const order = { schoolLanguage: 'SK', items };
    const { blocks } = reconstructBlocksForCategory(order, 'TOKOH_SHEET', [{ code: 'MP399', price: 12 }]);
    expect(blocks[0].blockTotalQty).toBe(3);
    expect(blocks[0].rows.map((r) => r.tokohFields.find((f) => f.key === 'namaMurid').value)).toEqual(['Ali 1B', 'Siti 1H', 'Wei 1J']);
  });

  // A likely typo (src/utils/typoCheck.js) now blocks Add to Cart instead
  // of only showing a hint — a teacher must fix the wording, not just see
  // it flagged, before the order can be submitted.
  it('blocks Add to Cart when a Reference Sample line has a likely typo', () => {
    const res = buildCategoryCartItems({
      lineValues: { 'TOKOH_SHEET::0::0': 'Majlis ANIGERAH', 'TOKOH_SHEET::0::2': 'TOKOH MURID' },
      matrixValues: {},
      rowsByBlock: { 'TOKOH_SHEET::0': [{ id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' }] },
      plakRows: {},
      columnsByBlock: {},
      plakCatalog: [{ code: 'MP399', price: 12 }],
      schoolLanguage: 'SK',
    }, 'TOKOH_SHEET');
    expect(res.items).toBeUndefined();
    expect(res.error).toMatch(/typo/i);
    expect(res.error).toMatch(/ANIGERAH/);
  });

  it('does not block on a legitimate word the dictionary has never seen (a school\'s own name)', () => {
    const res = buildCategoryCartItems(draftTokoh([
      { id: 1, desc: 'TOKOH MURID', qty: '1', jenisPlak: 'MP399', namaMurid: 'Ali' },
    ]), 'TOKOH_SHEET');
    expect(res.error).toBeUndefined();
  });
});
