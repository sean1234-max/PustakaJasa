import { standardUnitPrice } from '../data/catalog';

// Items placed with the original order never carry a `batch` field;
// approveAddOn (src/state/AppState.jsx) stamps every item from an approved
// add-on round with an incrementing `batch` number (1, 2, 3…) so the
// "which items came from where" distinction survives permanently, not
// just during the AddOnSummary draft-review screen. Groups items back
// into { batch: 0, label: 'Original Order', items } plus one group per
// add-on round, in submission order — used anywhere an order's items are
// shown as a flat table (SalesOrderSummary, AdminOrderDetail,
// ProductionOrderDetail).
// Merges rows that share the same Jenis Plak within one group into a
// single summed row — e.g. the same code ordered from two different
// category blocks (MP THP 1 and MP THP 2 both ordering DECO LIGHT) shows
// as one DECO LIGHT line instead of two. `ids` keeps every underlying
// item id so an edited price can be written back to all of them at once;
// `unitPrice` is the combined harga/qty (a weighted average, but exactly
// the original per-item price whenever every merged item already shares
// one). A Jenis Plak that only appears once still comes back as a single
// row — this is a no-op for the common case.
export function combineByJenisPlak(items) {
  const order = [];
  const byPlak = new Map();
  (items || []).forEach((it) => {
    if (!byPlak.has(it.jenisPlak)) {
      byPlak.set(it.jenisPlak, {
        key: it.jenisPlak, jenisPlak: it.jenisPlak, ids: [], qty: 0, harga: 0,
        originalHarga: 0, itemCount: 0, itemsWithOriginalPrice: 0,
      });
      order.push(it.jenisPlak);
    }
    const row = byPlak.get(it.jenisPlak);
    const qty = Number(it.qty) || 0;
    row.ids.push(it.id);
    row.qty += qty;
    row.harga += Number(it.harga) || 0;
    row.itemCount += 1;
    // Only combine an Original Price Per Unit across merged rows when
    // EVERY one of them actually has one (see AppState.jsx's approveOrder/
    // approveAddOn) — otherwise leave it undefined so the merged row shows
    // no original price rather than a misleading partial one.
    if (it.originalUnitPrice != null) {
      row.itemsWithOriginalPrice += 1;
      row.originalHarga += (it.originalUnitPrice != null ? it.originalUnitPrice : it.unitPrice) * qty;
    } else {
      row.originalHarga += (Number(it.unitPrice) || 0) * qty;
    }
  });
  return order.map((code) => {
    const row = byPlak.get(code);
    const hasOriginal = row.itemsWithOriginalPrice === row.itemCount;
    return {
      ...row,
      unitPrice: row.qty > 0 ? row.harga / row.qty : 0,
      originalUnitPrice: hasOriginal && row.qty > 0 ? row.originalHarga / row.qty : null,
    };
  });
}

// Splits ONE order into its billed invoice slices — for the Store Admin and
// Production dashboards, so a split order (orders.invoice_groups, 0070)
// shows one card per invoice number instead of a single card that only ever
// displayed the order's own (default) invoiceId/totalAmount/qty and
// silently hid the rest. The un-split case (the vast majority of orders)
// returns exactly one slice carrying the order's own
// invoiceId/totalAmount/totalQty UNCHANGED — no Jenis Plak scan needed, so
// there's zero behavior change for every normal order.
//
// A split order's slices are computed by summing each invoice's own items
// (getInvoiceItems below — a partially-moved Jenis Plak counts its moved
// QTY on the group and the rest on the default) — the order's own
// invoiceId for anything not listed in any group, each group's own
// invoiceId otherwise. A slice with zero Jenis Plak in it (can happen if
// every single one got split away, leaving nothing on the default) is
// simply omitted — the dashboard should never show a card for an invoice
// nothing is actually billed under.
// `plakCatalog` (optional — pass state.plakCatalog) lets each slice report
// its OWN priceAdjusted instead of the whole order's: a split order can
// have a price change on only one invoice's Jenis Plak (Store Admin edits
// prices per group before Approve), and the other invoice's card must not
// show the red "adjusted" styling just because a sibling invoice did. Only
// order.priceAdjusted (a persisted whole-order flag stamped at approve
// time — see AppState.jsx) exists to fall back on when no catalog is
// given, which is coarser than a real per-slice check, so it's used as-is
// for every slice in that case (matches every other page's own
// `order.priceAdjusted || rows.some(...)` fallback) rather than mixed in
// once a catalog makes the precise per-slice check possible.
//
// `status` is per-slice too: each invoice_groups entry can carry its own
// `status` (set independently by markProductionDone — AppState.jsx — once
// Production marks THAT invoice done) so a split order's invoices move
// through Waiting for Shipment/Shipped/Completed on their own instead of
// jumping together. A group with no `status` of its own yet (never marked
// done independently) just follows the order's own `status`, same as
// before this existed.
//
// `typedAt` likewise: Production's Done Typing (0078) for that invoice — the
// order's own typedAt for the default slice, the group's own for a split one
// (a new split invoice starts untyped).
export function getOrderInvoiceSlices(order, plakCatalog) {
  const groups = order.invoiceGroups || [];
  const priceAdjustedOf = (rows) => (plakCatalog
    ? rows.some((row) => row.unitPrice !== standardUnitPrice(row.jenisPlak, plakCatalog))
    : !!order.priceAdjusted);
  if (groups.length === 0) {
    const totalQty = (order.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    const priceAdjusted = priceAdjustedOf(combineByJenisPlak(order.items));
    return [{ invoiceId: order.invoiceId || null, totalAmount: order.totalAmount, totalQty, priceAdjusted, status: order.status, typedAt: order.typedAt }];
  }
  // Default slice first, then each group in the order Store Admin created
  // them — keeps card order stable/predictable.
  const keys = [order.invoiceId || null, ...groups.map((g) => g.invoiceId)];
  return keys.flatMap((key, i) => {
    const items = getInvoiceItems(order, key);
    if (items.length === 0) return [];
    return [{
      invoiceId: key,
      totalAmount: items.reduce((sum, it) => sum + (Number(it.harga) || 0), 0),
      totalQty: items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
      priceAdjusted: priceAdjustedOf(combineByJenisPlak(items)),
      status: i === 0 ? order.status : groups[i - 1].status || order.status,
      typedAt: i === 0 ? order.typedAt : groups[i - 1].typedAt,
    }];
  });
}

// How many pieces of `jenisPlak` a group bills, when Store Admin moved only
// PART of that Jenis Plak onto it (e.g. 5 of the 15 PKC 263 go on a new
// invoice, the other 10 stay on the order's own invoice). null = the whole
// Jenis Plak moved, which is also every group saved before partial splits
// existed (no `qtyByJenisPlak` at all).
export function partialSplitQty(group, jenisPlak) {
  const q = group?.qtyByJenisPlak?.[jenisPlak];
  return q == null ? null : Number(q) || 0;
}

// The items (with qty/harga cut down to just this invoice's share) billed
// under `invoiceId` — the order's own invoiceId (or null before it has one)
// for the default invoice, a group's invoiceId otherwise. A Jenis Plak moved
// whole sits on exactly one invoice; a partially-moved one shows up on both,
// the group's `qtyByJenisPlak` count on the group and the rest on the
// default. When one Jenis Plak spans several items (ordered from two
// categories), the group's count is taken from the first items first.
export function getInvoiceItems(order, invoiceId) {
  const groups = order.invoiceGroups || [];
  const defaultKey = order.invoiceId || null;
  const leftForGroup = new Map();
  return (order.items || []).flatMap((it) => {
    const group = groups.find((g) => (g.jenisPlakList || []).includes(it.jenisPlak));
    const q = partialSplitQty(group, it.jenisPlak);
    if (q == null) return (group ? group.invoiceId : defaultKey) === invoiceId ? [it] : [];
    const qty = Number(it.qty) || 0;
    const left = leftForGroup.has(it.jenisPlak) ? leftForGroup.get(it.jenisPlak) : q;
    const toGroup = Math.min(left, qty);
    leftForGroup.set(it.jenisPlak, left - toGroup);
    let share = 0;
    if (invoiceId === group.invoiceId) share = toGroup;
    else if (invoiceId === defaultKey) share = qty - toGroup;
    if (share <= 0) return [];
    return [{ ...it, qty: share, harga: qty > 0 ? ((Number(it.harga) || 0) * share) / qty : 0 }];
  });
}

// Validates the per-Jenis-Plak QTY Store Admin typed for a partial split
// against the order's `items`. A blank QTY, or one covering the whole Jenis
// Plak, means "move all of it" and gets no entry (same as before partial
// splits existed). Returns { qtyByJenisPlak } or { error }.
export function normalizeSplitQty(items, jenisPlakList, qtyDrafts) {
  const out = {};
  for (const key of jenisPlakList) {
    const raw = qtyDrafts?.[key];
    if (raw == null || raw === '') continue;
    const total = (items || []).filter((it) => it.jenisPlak === key).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    const q = Number(raw);
    if (!Number.isInteger(q) || q < 1 || q > total) return { error: `${key}: QTY must be a whole number from 1 to ${total}.` };
    if (q < total) out[key] = q;
  }
  return { qtyByJenisPlak: out };
}

export function groupItemsByBatch(items) {
  const groups = new Map();
  (items || []).forEach((it) => {
    const batch = it.batch || 0;
    if (!groups.has(batch)) groups.set(batch, []);
    groups.get(batch).push(it);
  });
  const addOnBatchCount = groups.size - (groups.has(0) ? 1 : 0);
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([batch, groupItems]) => ({
      batch,
      label: batch === 0 ? 'Original Order' : (addOnBatchCount > 1 ? `Tambahan #${batch}` : 'Tambahan'),
      items: groupItems,
    }));
}

// How an edit changes stock: per-Jenis-Plak quantity before → after, as
// what to take from stock (`deduct`) and what to give back (`restore`) —
// the { full_path, qty } shape deductPlakStock / restorePlakStock take.
export function stockDiff(beforeItems, afterItems) {
  const totals = (items) => (items || []).reduce(
    (map, it) => (it.jenisPlak ? map.set(it.jenisPlak, (map.get(it.jenisPlak) || 0) + (Number(it.qty) || 0)) : map),
    new Map(),
  );
  const before = totals(beforeItems);
  const after = totals(afterItems);
  const deduct = [];
  const restore = [];
  new Set([...before.keys(), ...after.keys()]).forEach((plak) => {
    const change = (after.get(plak) || 0) - (before.get(plak) || 0);
    if (change > 0) deduct.push({ full_path: plak, qty: change });
    if (change < 0) restore.push({ full_path: plak, qty: -change });
  });
  return { deduct, restore };
}
