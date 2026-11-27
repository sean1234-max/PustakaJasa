// Submit with no kertas kerja uploaded (Sean, 2026-11-05): a full-screen dialog asking whether the
// teacher's kertas kerja softcopy is at hand. Yes = back to its upload box; No = submit without it.
// `onNo` null = it is required (a salesman's new order, Sean 2026-11-26: Add to Cart checks the order against it).
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
        {onNo
          ? <>Do you have the teacher&apos;s kertas kerja softcopy?</>
          : <>The teacher&apos;s kertas kerja is needed for every order: the website checks the plaques against it when you Add to Cart.</>}
      </p>
      <div className="crystal-confirm-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>{onNo ? 'Yes — upload it' : 'Upload it'}</button>
        {onNo
          ? <button type="button" className="btn btn-ghost" disabled={busy} onClick={onNo}>{busy ? 'Submitting…' : 'No — submit order'}</button>
          : <button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>Not now</button>}
      </div>
    </dialog>
  );
}
