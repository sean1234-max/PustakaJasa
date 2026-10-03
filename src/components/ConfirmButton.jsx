import { useState } from 'react';

// A button that asks "are you sure?" right on the page instead of the
// browser's own confirm() pop-up. Chrome can silently block those ("prevent
// this page from creating additional dialogs") — confirm() then just returns
// false, and Done Review looked dead (Sean, 2026-10-03).
export default function ConfirmButton({
  label, question, confirmLabel = 'Yes', onConfirm, className = 'btn btn-primary', style, disabled, title,
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} style={style} disabled={disabled} title={title} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div style={{ ...style, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="hint-text" style={{ margin: 0, fontWeight: 600 }}>{question}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => { setAsking(false); onConfirm(); }}>{confirmLabel}</button>
        <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>Cancel</button>
      </div>
    </div>
  );
}
