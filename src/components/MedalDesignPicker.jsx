// MEDAL DESIGN picker (Sean, 2026-11-25): an ORDER LAIN-LAIN tab with medal rows picks one of the designs
// Production published on Medal Designs; its medals are then drawn with it in the Plak Preview below and made
// from that DESIGN group of E CUT 0. One design per tab — a second one goes on a copy of the sheet (Make a copy).
import { useEffect, useState } from 'react';
import { loadMedalDesigns, medalPictureUrl } from '../lib/medalDesignsApi';
import { designLabel, designLines, isPickable, sortDesigns } from '../utils/medalDesigns';

// a medal's lines (umumLines.js MEDAL_SLOT_FIELDS)
const MEDAL_LINES = [['event_header', '①'], ['year', '②'], ['position', '③'], ['event_line_1', '④'], ['event_line_2', '⑤']];

export default function MedalDesignPicker({ value, onPick }) {
  const [designs, setDesigns] = useState(null);
  useEffect(() => {
    let live = true;
    loadMedalDesigns().then((d) => { if (live) setDesigns(d); });
    return () => { live = false; };
  }, []);
  if (designs === null) return null;
  const pickable = sortDesigns(designs.filter(isPickable));
  const current = designs.find((d) => d.name === value) || null;
  const noPlace = current ? MEDAL_LINES.filter(([f]) => !designLines(current.preview?.templates).has(f)).map(([, mark]) => mark) : [];

  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div className="card-kicker">Medal Design</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        Pick how these medals look — ① top arc, ② bottom arc, ③ position, ④ and ⑤ the lines in the middle. One design
        per tab: for a second one, press Make a copy of this sheet (or copy the sheet in Excel) and keep each
        design&apos;s rows on its own tab.
      </p>
      {!value && <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>Pick a design before adding to cart.</p>}
      {pickable.length === 0 && <p className="hint-text">No medal design is published yet — please ask Production.</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
        {pickable.map((d) => {
          const picked = d.name === value;
          return (
            <button
              key={d.name}
              type="button"
              aria-pressed={picked}
              onClick={() => onPick(d.name)}
              className="card"
              style={{
                margin: 0, padding: 'var(--space-2)', cursor: 'pointer', textAlign: 'center',
                border: picked ? '3px solid var(--color-accent-700)' : '1px solid #ccc',
              }}
            >
              <img src={medalPictureUrl(d.preview.thumb)} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
              <div style={{ fontWeight: 600 }}>{picked ? '✓ ' : ''}{designLabel(d)}</div>
            </button>
          );
        })}
      </div>
      {current && !isPickable(current) && (
        <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>{designLabel(current)} is no longer offered — please pick another.</p>
      )}
      {noPlace.length > 0 && (
        <p className="hint-text">{designLabel(current)} has no place for {noPlace.join(' ')} — {noPlace.length > 1 ? 'those lines' : 'that line'} won&apos;t be printed.</p>
      )}
    </div>
  );
}
