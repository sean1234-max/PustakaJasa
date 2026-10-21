import { useAppState } from '../state/useAppState';

// A Tambahan's own order (0091, Sean 2026-10-14): "ADD ON" and the original order it adds to.
// `pending`: the original's card while its Tambahan waits for review (Sean, 2026-10-19).
// The original order itself says "ADA ADDON" once it has a Tambahan (Sean, 2026-10-21).
export default function AddOnTag({ order, pending = false }) {
  const { state } = useAppState();
  const parentId = pending ? order?.id : order?.parentOrderId;
  if (parentId) {
    return (
      <div className="order-stamp-inline" style={{ marginTop: 4 }}>
        ADD ON · Tambahan of {parentId}
      </div>
    );
  }
  const hasAddon = !!order?.id && state.orders.some((o) => o.parentOrderId === order.id && o.status !== 'Cancelled');
  if (!hasAddon) return null;
  return <div className="order-stamp-inline" style={{ marginTop: 4 }}>ADA ADDON</div>;
}
