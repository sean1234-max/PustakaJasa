import { useState } from 'react';

const SLOT_NUMBERS = [1, 2, 3, 4, 5];

// Lets Production/Admin mark where each numbered Reference Sample row's
// text should overlay on this slot's image (ReferenceImageOverlay.jsx
// renders the teacher-facing result). Click-to-place, not drag-to-place —
// Production only needs to confirm row arrangement is right (the real
// artwork is built separately in Adobe Illustrator), so no per-line font
// size/color/alignment controls either. `positions` is the slot's current
// `{ "1": {x,y}, ... }` map (may be empty/undefined); `onSave` receives
// the full updated map when the teacher clicks Save.
export default function ReferenceImagePositionEditor({ imageUrl, positions, onSave }) {
  const [draft, setDraft] = useState(() => positions || {});
  const [armed, setArmed] = useState(null);
  const [saved, setSaved] = useState(false);

  const handleImageClick = (e) => {
    if (!armed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setDraft((prev) => ({ ...prev, [armed]: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } }));
    setSaved(false);
  };

  const clearSlot = (num) => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[num];
      return next;
    });
    if (armed === num) setArmed(null);
    setSaved(false);
  };

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
  };

  return (
    <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', border: '1px solid var(--color-neutral-300)', background: '#fafafa' }}>
      <p className="hint-text" style={{ margin: '0 0 var(--space-2)' }}>
        Click a row number below, then click on the picture to place it there — this only needs to roughly match where each row goes, not the final artwork.
      </p>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        {SLOT_NUMBERS.map((num) => (
          <div key={num} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              type="button"
              className={`btn ${armed === num ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '4px 10px' }}
              onClick={() => setArmed(num)}
            >
              {num}{draft[num] ? ' ✓' : ''}
            </button>
            {draft[num] && (
              <button type="button" className="btn btn-ghost btn-icon" aria-label={`Clear position ${num}`} onClick={() => clearSlot(num)}>✕</button>
            )}
          </div>
        ))}
      </div>

      <div
        style={{ position: 'relative', display: 'inline-block', maxWidth: 480, width: '100%', cursor: armed ? 'crosshair' : 'default' }}
        onClick={handleImageClick}
      >
        <img src={imageUrl} alt="Reference sample" style={{ width: '100%', display: 'block' }} />
        {SLOT_NUMBERS.map((num) => {
          const pos = draft[num];
          if (!pos) return null;
          return (
            <div
              key={num}
              style={{
                position: 'absolute',
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                transform: 'translate(-50%, -50%)',
                width: 22, height: 22, borderRadius: '50%',
                background: armed === num ? 'var(--color-accent-700)' : '#1d1f20',
                color: '#fff', fontSize: 12, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              {num}
            </div>
          );
        })}
      </div>

      <div className="row-actions" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-primary" onClick={handleSave}>Save Positions</button>
        {saved && <span className="hint-text" style={{ marginLeft: 'var(--space-2)' }}>Saved.</span>}
      </div>
    </div>
  );
}
