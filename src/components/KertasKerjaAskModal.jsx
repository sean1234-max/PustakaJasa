// Submit with no kertas kerja uploaded (Sean, 2026-11-05): a full-screen dialog asking whether the
// teacher's kertas kerja softcopy is at hand. Yes = back to its upload box; No = submit without it.
// Same look as ShipmentConfirmModal (the browser's own modal <dialog>; Esc = close, nothing sent).
import { useEffect, useRef } from 'react';

export default function KertasKerjaAskModal({ open, busy, onYes, onNo, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref} className="crystal-confirm" aria-labelledby="kertasKerjaAskTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onClose(); }}
    >
      <div id="kertasKerjaAskTitle" className="crystal-confirm-title">KERTAS KERJA GURU</div>
      <p className="crystal-confirm-text">
        No kertas kerja uploaded yet.
        <br />
        Do you have the teacher&apos;s kertas kerja softcopy?
      </p>
      <div className="crystal-confirm-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>Yes — upload it</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onNo}>{busy ? 'Submitting…' : 'No — submit order'}</button>
      </div>
    </dialog>
  );
}
