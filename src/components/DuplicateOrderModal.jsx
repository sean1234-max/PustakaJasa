// The school already has orders that look like this one (0094): asked full-screen before the
// order goes in (Sean, 2026-10-15 — the inline box was too easy to miss). The browser's own
// modal <dialog>: dark backdrop, the page behind can't be used, Esc = No.
import { useEffect, useRef } from 'react';
import { formatDate, toMalaysiaDay } from '../data/catalog';
import { duplicateReasons } from '../utils/duplicateOrders';

export default function DuplicateOrderModal({ sekolah, orders, busy, onYes, onNo }) {
  const ref = useRef(null);
  const open = !!orders;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref} className="big-dialog" aria-labelledby="dupTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onNo(); }}
    >
      <div id="dupTitle" className="big-dialog-title">⚠ POSSIBLE DUPLICATE ORDER</div>
      <p className="big-dialog-text">
        {sekolah} already has {orders?.length === 1 ? 'an order that looks' : 'orders that look'} like this one:
      </p>
      <ul className="big-dialog-list">
        {(orders || []).map((d) => (
          <li key={d.id}>
            <strong>{d.id}</strong> — {d.status}, placed {formatDate(toMalaysiaDay(d.createdAt))} by {d.submittedBy}
            {d.functionDate ? `, Function ${formatDate(toMalaysiaDay(d.functionDate))}` : ''}, RM {d.totalAmount.toFixed(2)}
            <div className="big-dialog-why">{duplicateReasons(d.reasons)}</div>
          </li>
        ))}
      </ul>
      <p className="big-dialog-text"><strong>Is this a separate, new order?</strong></p>
      <div className="big-dialog-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>
          {busy ? 'Submitting…' : 'Yes, a separate order — submit'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onNo}>No, don&apos;t submit</button>
      </div>
    </dialog>
  );
}
