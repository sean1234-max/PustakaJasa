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
      byPlak.set(it.jenisPlak, { key: it.jenisPlak, jenisPlak: it.jenisPlak, ids: [], qty: 0, harga: 0 });
      order.push(it.jenisPlak);
    }
    const row = byPlak.get(it.jenisPlak);
    row.ids.push(it.id);
    row.qty += Number(it.qty) || 0;
    row.harga += Number(it.harga) || 0;
  });
  return order.map((code) => {
    const row = byPlak.get(code);
    return { ...row, unitPrice: row.qty > 0 ? row.harga / row.qty : 0 };
  });
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
