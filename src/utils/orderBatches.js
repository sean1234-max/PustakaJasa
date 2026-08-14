// Items placed with the original order never carry a `batch` field;
// approveAddOn (src/state/AppState.jsx) stamps every item from an approved
// add-on round with an incrementing `batch` number (1, 2, 3…) so the
// "which items came from where" distinction survives permanently, not
// just during the AddOnSummary draft-review screen. Groups items back
// into { batch: 0, label: 'Original Order', items } plus one group per
// add-on round, in submission order — used anywhere an order's items are
// shown as a flat table (SalesOrderSummary, AdminOrderDetail,
// ProductionOrderDetail).
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
