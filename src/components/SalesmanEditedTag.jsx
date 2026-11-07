import { formatDateTime } from '../data/catalog';

// "Edited by salesman" (Sean, 2026-11-07): the salesman changed this order with Edit Order before
// Production's review (AppState.jsx saveEditedOrder) — shown wherever "Excel Updated" is.
export default function SalesmanEditedTag({ order, style }) {
  if (!order?.salesmanEditedAt) return null;
  return (
    <span className="status-pill no-print" style={{ background: '#e6efff', color: '#1f4e9c', ...style }} title={`Last edited ${formatDateTime(order.salesmanEditedAt)}`}>
      Edited by salesman
    </span>
  );
}
