import { useState } from 'react';
import { useAppState } from '../state/useAppState';
import { formatDateTime } from '../data/catalog';

// Shared "Cancel Order" action, used from the Sales / Admin / teacher order
// screens. WHO may cancel and FROM WHICH status is enforced server-side by
// orders_write_guard (supabase/migrations/0042_order_cancellation.sql) — the
// caller decides whether to render this at all (role + status), and the
// server has the final say. On success the deducted stock is restored by
// AppState.jsx's cancelOrder(); `onCancelled` lets the parent navigate away
// or refresh.
export default function CancelOrderControl({ order, onCancelled }) {
  const { cancelOrder } = useAppState();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (order.status === 'Cancelled') {
    return (
      <div className="login-error" style={{ marginTop: 'var(--space-4)' }}>
        This order was cancelled{order.cancelledAt ? ` on ${formatDateTime(order.cancelledAt)}` : ''}.
        {order.cancelReason ? ` Reason: ${order.cancelReason}` : ''}
      </div>
    );
  }

  const doCancel = async () => {
    setBusy(true);
    setError('');
    const res = await cancelOrder(order.id, reason);
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      setReason('');
      onCancelled?.(res);
    } else {
      setError(res.message || 'Could not cancel this order.');
    }
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(true)}>
        Cancel Order
      </button>
    );
  }

  return (
    <div className="field" style={{ maxWidth: 460 }}>
      <label htmlFor={`cancelReason-${order.id}`}>
        Reason for cancelling (optional, kept on record)
      </label>
      <input
        className="input"
        id={`cancelReason-${order.id}`}
        placeholder="e.g. school submitted a duplicate order"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
      />
      {error && <p className="hint-text" style={{ color: '#b0392e', fontWeight: 600, marginTop: 4 }}>{error}</p>}
      <div className="row-split" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setError(''); }} disabled={busy}>
          Keep Order
        </button>
        <button type="button" className="btn btn-danger" onClick={doCancel} disabled={busy}>
          {busy ? 'Cancelling…' : 'Cancel This Order'}
        </button>
      </div>
    </div>
  );
}
