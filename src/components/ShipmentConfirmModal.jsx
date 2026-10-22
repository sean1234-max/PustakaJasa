// Before a salesman approves an order (Sean, 2026-10-22): a full-screen dialog asking whether the
// Shipment Date is right. CONFIRM approves; NOT CONFIRM closes it so the date can be changed first.
// Same look as CrystalConfirmModal (the browser's own modal <dialog>; Esc = NOT CONFIRM).
import { useEffect, useRef } from 'react';

export default function ShipmentConfirmModal({ open, date, urgent = false, busy, onConfirm, onNotConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref} className="crystal-confirm" aria-labelledby="shipmentConfirmTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onNotConfirm(); }}
    >
      <div id="shipmentConfirmTitle" className="crystal-confirm-title">CONFIRM SHIPMENT DATE</div>
      <p className="crystal-confirm-text">
        Shipment Date: <strong>{date || '—'}</strong>
        <br />
        Is this Shipment Date correct?
        {urgent && <><br /><strong>⚡ This order will be marked Urgent.</strong></>}
      </p>
      <div className="crystal-confirm-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          {busy ? 'Approving…' : 'CONFIRM — Approve'}
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onNotConfirm}>NOT CONFIRM — change the date</button>
      </div>
    </dialog>
  );
}
