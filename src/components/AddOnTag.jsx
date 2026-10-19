// A Tambahan's own order (0091, Sean 2026-10-14): "ADD ON" and the original order it adds to.
// `pending`: the original's card while its Tambahan waits for review (Sean, 2026-10-19).
export default function AddOnTag({ order, pending = false }) {
  const parentId = pending ? order?.id : order?.parentOrderId;
  if (!parentId) return null;
  return (
    <div className="order-stamp-inline" style={{ marginTop: 4 }}>
      ADD ON · Tambahan of {parentId}
    </div>
  );
}
