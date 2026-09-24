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
// A split order's slices are computed by summing each Jenis Plak's
// harga/qty (via combineByJenisPlak, same combining the price table/split
// panel already use) into whichever invoice it belongs to — the order's own
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
// through Waiting for Delivery/Shipped/Completed on their own instead of
// jumping together. A group with no `status` of its own yet (never marked
// done independently) just follows the order's own `status`, same as
// before this existed.
export function getOrderInvoiceSlices(order, plakCatalog) {
  const groups = order.invoiceGroups || [];
  const priceAdjustedOf = (rows) => (plakCatalog
    ? rows.some((row) => row.unitPrice !== standardUnitPrice(row.jenisPlak, plakCatalog))
    : !!order.priceAdjusted);
  if (groups.length === 0) {
    const totalQty = (order.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
    const priceAdjusted = priceAdjustedOf(combineByJenisPlak(order.items));
    return [{ invoiceId: order.invoiceId || null, totalAmount: order.totalAmount, totalQty, priceAdjusted, status: order.status }];
  }
  const totalsByInvoice = new Map();
  const qtyByInvoice = new Map();
  const rowsByInvoice = new Map();
  const defaultKey = order.invoiceId || null;
  combineByJenisPlak(order.items).forEach((row) => {
    const match = groups.find((g) => (g.jenisPlakList || []).includes(row.jenisPlak));
    const key = match ? match.invoiceId : defaultKey;
    totalsByInvoice.set(key, (totalsByInvoice.get(key) || 0) + row.harga);
    qtyByInvoice.set(key, (qtyByInvoice.get(key) || 0) + row.qty);
    if (!rowsByInvoice.has(key)) rowsByInvoice.set(key, []);
    rowsByInvoice.get(key).push(row);
  });
  // Default slice first (even though it's just been computed into the same
  // map), then each group in the order Store Admin created them — keeps
  // card order stable/predictable rather than following Map insertion order
  // (which follows whichever Jenis Plak happened to appear first).
  const slices = [];
  if (totalsByInvoice.has(defaultKey)) {
    slices.push({
      invoiceId: defaultKey, totalAmount: totalsByInvoice.get(defaultKey), totalQty: qtyByInvoice.get(defaultKey),
      priceAdjusted: priceAdjustedOf(rowsByInvoice.get(defaultKey) || []),
      status: order.status,
    });
  }
  groups.forEach((g) => {
    if (totalsByInvoice.has(g.invoiceId)) {
      slices.push({
        invoiceId: g.invoiceId, totalAmount: totalsByInvoice.get(g.invoiceId), totalQty: qtyByInvoice.get(g.invoiceId),
        priceAdjusted: priceAdjustedOf(rowsByInvoice.get(g.invoiceId) || []),
        status: g.status || order.status,
      });
    }
  });
  return slices;
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
