import { useState } from 'react';
import { useAppState } from '../state/useAppState';
import { fetchAllSalesmen } from '../lib/ordersApi';

// For when the teacher picked the wrong salesman at submit (they can name
// ANY salesman, not just whoever actually covers their school — see
// AppState.jsx's submitOrder) — lets the salesman who currently owns the
// order hand it off to the right one instead of asking the teacher to
// re-upload. Only the current owner sees this (SalesOrderSummary gates on
// isOwn); the RPC re-checks that server-side too. Once it succeeds this
// salesman no longer owns the order — `onReassigned` lets the parent
// navigate away, since staying on this page would show an order that just
// dropped out of state.orders.
export default function ReassignSalesmanControl({ order, onReassigned }) {
  const { reassignSalesman } = useAppState();
  const [open, setOpen] = useState(false);
  const [salesmen, setSalesmen] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const startOpen = async () => {
    setOpen(true);
    setError('');
    if (salesmen) return;
    try {
      const all = await fetchAllSalesmen();
      setSalesmen(all.filter((s) => s.id !== order.salesmanId).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setSalesmen([]);
      setError('Could not load the salesman list. Please try again.');
    }
  };

  const doReassign = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError('');
    const res = await reassignSalesman(order.id, selectedId);
    setBusy(false);
    if (res.ok) onReassigned?.();
    else setError(res.message || 'Could not reassign this order.');
  };

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost" onClick={startOpen}>
        Reassign to Another Salesman
      </button>
    );
  }

  return (
    <div className="field" style={{ maxWidth: 420 }}>
      <label htmlFor={`reassignTo-${order.id}`}>Reassign this order to</label>
      {salesmen === null ? (
        <p className="hint-text">Loading salesmen…</p>
      ) : (
        <select
          className="input"
          id={`reassignTo-${order.id}`}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={busy}
        >
          <option value="">— Select a salesman —</option>
          {salesmen.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {error && <p className="hint-text" style={{ color: '#b0392e', fontWeight: 600, marginTop: 4 }}>{error}</p>}
      <div className="row-split" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setError(''); setSelectedId(''); }} disabled={busy}>
          Keep It
        </button>
        <button type="button" className="btn btn-primary" onClick={doReassign} disabled={busy || !selectedId}>
          {busy ? 'Reassigning…' : 'Confirm Reassign'}
        </button>
      </div>
    </div>
  );
}
