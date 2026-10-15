// The teacher's crystal artwork check before submitting (Sean, 2026-10-15): a full-screen
// dialog (the browser's own modal <dialog>: dark backdrop, the page behind can't be used,
// Esc = Cancel). Nothing is submitted until "Yes, Artwork Confirmed".
import { useEffect, useRef } from 'react';

export default function CrystalConfirmModal({ open, busy, onYes, onEdit, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref} className="crystal-confirm" aria-labelledby="crystalConfirmTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    >
      <div id="crystalConfirmTitle" className="crystal-confirm-title">CRYSTAL ARTWORK CONFIRMATION</div>
      <p className="crystal-confirm-text">Your order contains Crystal items. Have you confirmed the artwork?</p>
      <div className="crystal-confirm-actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>
          {busy ? 'Submitting…' : 'Yes, Artwork Confirmed'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onEdit}>No, Edit Crystal</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel / No</button>
      </div>
    </dialog>
  );
}
