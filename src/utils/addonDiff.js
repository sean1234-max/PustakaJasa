import { resolveCategory, CUSTOM_MATRIX_LABEL_SUFFIX } from '../data/catalog';
import { buildDraftFromOrder } from './computeBlocks';
import { buildInitialRowsByBlock, buildInitialColumnsByBlock, buildInitialPlakRows } from '../data/formDefaults';

// Tambahan as "the order so far, with more" (Sean, 2026-11-10): Add On opens with the original
// order plus every Tambahan already made, the salesman raises a QTY or adds a new row, and only
// what grew becomes the Tambahan (BM 10 → 14 = a Tambahan of 4). Original rows can't be lowered,
// removed or reworded.
//
// An item is matched to the one it continues by its signature: category, Jenis Plak, ALIRAN place
// range, its wording lines (block number left out) and — one item per row (TOKOH / LONJAKAN …) —
// the row itself. Rows and matrix cells are then compared one by one.

const num = (v) => Number(v) || 0;
const ROW_VALUE_KEYS = new Set(['id', 'qty', 'unitPrice', 'nameSurcharge', 'harga', 'rawHarga']);
const sortedJson = (obj) => JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const clean = (v) => String(v ?? '').trim().toUpperCase();

// A row without its quantity / id / price: what makes it "the same row".
export function rowKey(row) {
  const out = {};
  Object.keys(row || {}).forEach((k) => {
    if (ROW_VALUE_KEYS.has(k)) return;
    const v = clean(row[k]);
    if (v) out[k] = v;
  });
  return sortedJson(out);
}

// The wording lines without the block number ("MP2::0::2" → "2") and blank lines.
function linesKey(item) {
  const out = {};
  Object.entries(item.detail?.lines || {}).forEach(([k, v]) => {
    const slot = k.replace(/^.*?::\d+::/, '');
    const val = clean(v);
    if (val) out[slot] = val;
  });
  return sortedJson(out);
}

const perRow = (item) => !!resolveCategory(item.categoryKey)?.plakPerRow;

export function itemSignature(item) {
  return [
    item.categoryKey || '', clean(item.jenisPlak), `${item.posDari || ''}-${item.posHingga || ''}`, linesKey(item),
    perRow(item) ? (item.detail?.rows || []).map(rowKey).join('|') : '',
  ].join('\u0001');
}

// A matrix cell named by what it means, not by its row / column ids: a custom row by its
// __label__, a PBD / ALIRAN subject by its desc, a Tahun column by its range + class.
function cellNames(detail) {
  const matrix = detail?.matrix || {};
  const rows = new Map((detail?.rows || []).map((r) => [String(r.id), clean(r.desc)]));
  const cols = new Map((detail?.columns || []).map((c) => [String(c.id), [c.tahunFrom, c.tahunTo, c.namaKelas, c.name].map(clean).join('/')]));
  const out = new Map(); // raw key → name
  Object.keys(matrix).forEach((k) => {
    if (k.endsWith(CUSTOM_MATRIX_LABEL_SUFFIX)) return;
    const parts = k.split('::');
    const col = parts.pop();
    const rowPrefix = parts.join('::');
    const rowId = parts[parts.length - 1];
    const label = matrix[`${rowPrefix}${CUSTOM_MATRIX_LABEL_SUFFIX}`];
    const rowName = label != null ? clean(label) : (rows.get(rowId) ?? rowId);
    out.set(k, `${rowName}\u0002${cols.get(col) ?? col}`);
  });
  return out;
}

// A list block's own rows carry the quantities (OTHERS / SELEMPANG …); a matrix block's rows
// are only its subjects, and one-item-per-row items are matched whole.
const rowsHoldQty = (item) => !item.detail?.matrix && !perRow(item) && Array.isArray(item.detail?.rows);

function itemQty(item) {
  return num(item.qty);
}

// What `next` adds to `base` (the same item, maybe grown). problems: rows / cells it lowered or lost.
function diffItem(base, next) {
  const problems = [];
  let detail = next.detail;
  if (next.detail?.matrix) {
    const baseNames = cellNames(base.detail);
    const baseByName = new Map();
    baseNames.forEach((name, k) => baseByName.set(name, num(base.detail.matrix[k])));
    const nextNames = cellNames(next.detail);
    const kept = {};
    const seen = new Set();
    nextNames.forEach((name, k) => {
      const delta = num(next.detail.matrix[k]) - (baseByName.get(name) || 0);
      seen.add(name);
      if (delta < 0) problems.push(name.split('\u0002').filter(Boolean).join(' '));
      if (delta > 0) kept[k] = String(delta);
    });
    baseByName.forEach((v, name) => { if (v > 0 && !seen.has(name)) problems.push(name.split('\u0002').filter(Boolean).join(' ')); });
    // the labels of the custom rows still in it
    Object.keys(next.detail.matrix).forEach((k) => {
      if (!k.endsWith(CUSTOM_MATRIX_LABEL_SUFFIX)) return;
      const prefix = k.slice(0, -CUSTOM_MATRIX_LABEL_SUFFIX.length);
      if (Object.keys(kept).some((ck) => ck.startsWith(`${prefix}::`))) kept[k] = next.detail.matrix[k];
    });
    detail = { ...next.detail, matrix: kept };
  } else if (rowsHoldQty(next)) {
    const baseRows = new Map();
    (base.detail?.rows || []).forEach((r) => baseRows.set(rowKey(r), (baseRows.get(rowKey(r)) || 0) + num(r.qty)));
    // rows alike (two honourees' same sash) are counted together
    const nextRows = new Map();
    next.detail.rows.forEach((r) => {
      const k = rowKey(r);
      const had = nextRows.get(k);
      nextRows.set(k, { row: had?.row || r, qty: (had?.qty || 0) + num(r.qty) });
    });
    const rows = [];
    const seen = new Set();
    nextRows.forEach(({ row, qty: q }, k) => {
      const delta = q - (baseRows.get(k) || 0);
      seen.add(k);
      if (delta < 0) problems.push(row.desc || row.acara || 'a row');
      if (delta > 0) rows.push({ ...row, qty: String(delta) });
    });
    (base.detail?.rows || []).forEach((r) => { if (num(r.qty) > 0 && !seen.has(rowKey(r))) problems.push(r.desc || r.acara || 'a row'); });
    detail = { ...next.detail, rows };
  }
  const qty = itemQty(next) - itemQty(base);
  if (qty < 0 && problems.length === 0) problems.push(next.jenisPlak || 'QTY');
  return { qty, detail, problems };
}

const label = (it) => `${it.categoryLabel || it.categoryKey} · ${it.jenisPlak || '—'}`;

function pairBySignature(baseItems, nextItems) {
  const pool = new Map();
  baseItems.forEach((b) => {
    const s = itemSignature(b);
    pool.set(s, [...(pool.get(s) || []), b]);
  });
  const pairs = nextItems.map((n) => {
    const list = pool.get(itemSignature(n)) || [];
    const base = list.shift() || null;
    return { base, next: n };
  });
  const unmatchedBase = [...pool.values()].flat();
  return { pairs, unmatchedBase };
}

// The Tambahan from the Add On page's items (`nextItems`, only the categories it rebuilt) against
// the order so far (`baseItems`). Returns { items, errors }: items = what grew, as new cart items.
export function diffAddonItems(baseItems, nextItems) {
  const cats = new Set(nextItems.map((it) => it.categoryKey));
  const { pairs, unmatchedBase } = pairBySignature((baseItems || []).filter((b) => cats.has(b.categoryKey)), nextItems);
  const errors = [];
  const items = [];
  unmatchedBase.forEach((b) => {
    if (itemQty(b) > 0) errors.push(`${label(b)}: an original row was changed or removed — only QTY can go up, and new rows can be added.`);
  });
  pairs.forEach(({ base, next }) => {
    if (!base) {
      if (itemQty(next) > 0) items.push({ ...next, id: crypto.randomUUID(), addonDiff: true });
      return;
    }
    const { qty, detail, problems } = diffItem(base, next);
    if (problems.length) {
      errors.push(`${label(next)}: ${[...new Set(problems)].join(', ')} — a Tambahan can't lower or remove what the order already has.`);
      return;
    }
    if (qty <= 0) return;
    const unitPrice = next.unitPrice;
    const harga = Number.isFinite(Number(unitPrice)) && unitPrice !== null && unitPrice !== ''
      ? Number(unitPrice) * qty
      : num(next.harga) * (qty / (itemQty(next) || 1));
    items.push({ ...next, id: crypto.randomUUID(), qty, harga, detail, addonDiff: true });
  });
  return { items, errors };
}

// One item grown by `extra` (an earlier Tambahan of the same item): rows / cells summed.
function addInto(item, extra) {
  const qty = itemQty(item) + itemQty(extra);
  let detail = item.detail;
  if (item.detail?.matrix && extra.detail?.matrix) {
    const names = cellNames(item.detail);
    const byName = new Map([...names].map(([k, n]) => [n, k]));
    const matrix = { ...item.detail.matrix };
    const extraNames = cellNames(extra.detail);
    const extraOnly = {};
    extraNames.forEach((name, k) => {
      const own = byName.get(name);
      if (own) matrix[own] = String(num(matrix[own]) + num(extra.detail.matrix[k]));
      else extraOnly[k] = extra.detail.matrix[k];
    });
    // a cell only the Tambahan has (a new custom row): taken over with its label
    Object.keys(extraOnly).forEach((k) => {
      matrix[k] = String(num(matrix[k]) + num(extraOnly[k]));
      const prefix = k.split('::').slice(0, -1).join('::');
      const lbl = extra.detail.matrix[`${prefix}${CUSTOM_MATRIX_LABEL_SUFFIX}`];
      if (lbl != null) matrix[`${prefix}${CUSTOM_MATRIX_LABEL_SUFFIX}`] = lbl;
    });
    detail = { ...item.detail, matrix };
  } else if (rowsHoldQty(item) && Array.isArray(extra.detail?.rows)) {
    const rows = item.detail.rows.map((r) => ({ ...r }));
    extra.detail.rows.forEach((r) => {
      const own = rows.find((x) => rowKey(x) === rowKey(r));
      if (own) own.qty = String(num(own.qty) + num(r.qty));
      else rows.push({ ...r });
    });
    detail = { ...item.detail, rows };
  }
  const harga = num(item.harga) + num(extra.harga);
  return { ...item, qty, harga, detail };
}

// The order so far: the original's items with every earlier Tambahan folded in. A Tambahan item
// that continues an original one is added into it; a new one joins as its own item, in its own
// block when its block number is already taken by different wording (and the category has a free
// block), else left out of the page.
// ponytail: a Tambahan block that can't find a free block slot is dropped from the page (and so
// from the comparison) — only an order whose category is already full of blocks hits this.
export function mergeTambahanItems(originalItems, tambahanItems) {
  let merged = (originalItems || []).map((it) => ({ ...it }));
  (tambahanItems || []).forEach((t) => {
    const s = itemSignature(t);
    const at = merged.findIndex((m) => itemSignature(m) === s);
    if (at >= 0) {
      merged = merged.map((m, i) => (i === at ? addInto(m, t) : m));
      return;
    }
    const sameCat = merged.filter((m) => m.categoryKey === t.categoryKey);
    const blockOf = (m) => m.blockIdx ?? 0;
    const tb = blockOf(t);
    const clash = sameCat.some((m) => blockOf(m) === tb && linesKey(m) !== linesKey(t));
    if (!clash) {
      merged = [...merged, { ...t }];
      return;
    }
    const slots = resolveCategory(t.categoryKey)?.blocksCount || 1;
    const used = new Set(sameCat.map(blockOf));
    const free = [...Array(slots).keys()].find((b) => !used.has(b));
    if (free == null) return;
    const lines = Object.fromEntries(Object.entries(t.detail?.lines || {}).map(([k, v]) => [k.replace(/^(.*?::)\d+(::)/, `$1${free}$2`), v]));
    merged = [...merged, { ...t, blockIdx: free, detail: { ...t.detail, lines } }];
  });
  return merged;
}

// The Add On page's starting draft (New Order field names): the order so far, every category
// open as it was ordered. baseItems: what the Tambahan is compared against.
export function addonPrefill(order, tambahans, schoolLanguage = 'SK') {
  const live = (tambahans || []).filter((t) => t.status !== 'Cancelled');
  const baseItems = mergeTambahanItems(order.items || [], live.flatMap((t) => t.items || []));
  const restored = buildDraftFromOrder({ items: baseItems });
  return {
    baseItems,
    category: restored.category,
    lineValues: restored.lineValues,
    matrixValues: restored.matrixValues,
    rowsByBlock: { ...buildInitialRowsByBlock(schoolLanguage), ...restored.rowsByBlock },
    columnsByBlock: { ...buildInitialColumnsByBlock(), ...restored.columnsByBlock },
    plakRows: { ...buildInitialPlakRows(), ...restored.plakRows },
    nextId: Math.max(1000, restored.nextId),
    visibleBlocksByCategory: restored.visibleBlocksByCategory,
  };
}
