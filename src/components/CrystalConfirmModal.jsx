// The teacher's crystal artwork check before submitting (Sean, 2026-10-15): a full-screen
// dialog (the browser's own modal <dialog>: dark backdrop, the page behind can't be used,
// Esc = Cancel). "Yes, Artwork Confirmed" asks once more — the crystals go to Production
// as they are (Sean, 2026-10-16) — and only "Yes, send to Production" submits.
// onLater (salesman only): submit now, confirm the artwork later on the order's Summary page.
import { useEffect, useRef, useState } from 'react';

export default function CrystalConfirmModal({ open, busy, onYes, onLater = null, onEdit, onCancel }) {
  const ref = useRef(null);
  const [doubleCheck, setDoubleCheck] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
    if (!open) setDoubleCheck(false);
  }, [open]);

  return (
    <dialog
      ref={ref} className="crystal-confirm" aria-labelledby="crystalConfirmTitle"
      onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    >
      {doubleCheck ? (
        <>
          <div id="crystalConfirmTitle" className="crystal-confirm-title">PLEASE DOUBLE CONFIRM</div>
          <p className="crystal-confirm-text">
            Your crystals will now go to Production and be made exactly as shown in the Crystal Preview.
            Are you sure the artwork (design, words, logo) is correct?
          </p>
          <div className="crystal-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onYes}>
              {busy ? 'Submitting…' : 'Yes, send to Production'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDoubleCheck(false)}>No, go back</button>
          </div>
        </>
      ) : (
        <>
          <div id="crystalConfirmTitle" className="crystal-confirm-title">CRYSTAL ARTWORK CONFIRMATION</div>
          <p className="crystal-confirm-text">Your order contains Crystal items. Have you confirmed the artwork?</p>
          <div className="crystal-confirm-actions">
            <button type="button" className="btn btn-primary" onClick={() => setDoubleCheck(true)}>Yes, Artwork Confirmed</button>
            {onLater && (
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={onLater}>
                {busy ? 'Submitting…' : 'Not yet — submit, confirm artwork later'}
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={onEdit}>No, Edit Crystal</button>
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel / No</button>
          </div>
        </>
      )}
    </dialog>
  );
}
