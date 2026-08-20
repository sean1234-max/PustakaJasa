// Flags an order that carries an approved Add-On round — for the red
// "ADD ON" stamp on Sales' printed order (SalesOrderSummary.jsx) and the
// matching badge on Production's order views. batch > 0 items only exist
// once Sales has approved an Add-On round (see approveAddOn in
// src/state/AppState.jsx), so this is unambiguous — no comparison against
// the order's original quantity is needed.
export function getOrderChangeStamp(order) {
  if (!order) return null;
  const hasApprovedAddOn = (order.items || []).some((it) => (it.batch || 0) > 0);
  return hasApprovedAddOn ? 'ADD ON' : null;
}
