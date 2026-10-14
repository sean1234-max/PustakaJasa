// A Tambahan's own order (0091, Sean 2026-10-14): "ADD ON" and the original order it adds to.
export default function AddOnTag({ order }) {
  if (!order?.parentOrderId) return null;
  return (
    <div className="order-stamp-inline" style={{ marginTop: 4 }}>
      ADD ON · Tambahan of {order.parentOrderId}
    </div>
  );
}
