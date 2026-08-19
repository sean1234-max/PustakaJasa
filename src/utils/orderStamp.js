// Classifies how an order changed after it was first submitted, for the
// red "ADD ON / AMEND / UPDATED DETAILS" stamp on Sales' printed order
// (SalesOrderSummary.jsx) and the matching badge on Production's order
// views. An approved Add On always wins the classification outright — it's
// unambiguous (batch > 0 items only exist once Sales has approved an
// Add-On round, see approveAddOn in src/state/AppState.jsx). Otherwise, if
// the teacher used "Update Details" (Amend) before Sales ever approved the
// order, the classification comes from comparing the order's current total
// quantity against `originalTotalQty` — the frozen snapshot taken at the
// moment the order was first submitted (see submitOrder):
//   - total qty went up   -> 'ADD ON' (more was ordered, even though it
//     went through the Amend flow rather than the separate Add On feature)
//   - total qty went down -> 'AMEND'
//   - total qty unchanged -> 'UPDATED DETAILS' (only the order's text
//     content changed, e.g. reference sample lines or Jenis Plak choice)
// Returns null when nothing about the order has changed since submission.
export function getOrderChangeStamp(order) {
  if (!order) return null;
  const hasApprovedAddOn = (order.items || []).some((it) => (it.batch || 0) > 0);
  if (hasApprovedAddOn) return 'ADD ON';

  if (!order.amended || order.originalTotalQty == null) return null;
  const currentQty = (order.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  if (currentQty > order.originalTotalQty) return 'ADD ON';
  if (currentQty < order.originalTotalQty) return 'AMEND';
  return 'UPDATED DETAILS';
}
