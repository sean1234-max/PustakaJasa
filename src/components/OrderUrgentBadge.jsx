export default function OrderUrgentBadge({ urgent }) {
  if (!urgent) return null;
  return <span className="order-urgent-badge">URGENT</span>;
}
