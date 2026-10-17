// Filling in "Reserved" names on an order already In Production (Sean, 2026-10-17): Production
// or the order's salesman types each real name; once none is left the KIV card leaves KIV &
// ARTWORK on its own (0097 fill_reserved_names). A row left blank stays Reserved.
// A crystal row has Preview crystal (Sean, 2026-10-17): the crystal drawn with the names typed so
// far, before Save, so the salesman sees how it will look.
import { useState } from 'react';
import { isReservedName, isCrystalCode } from '../utils/exportCsv';
import { resolveCategory } from '../data/catalog';
import CrystalPreview from './CrystalPreview';

// The order with the typed names in place of "Reserved" (only on screen — nothing saved).
function withTypedNames(order, filled) {
  return {
    ...order,
    items: (order.items || []).map((it) => (Array.isArray(it.detail?.rows) && it.detail.rows.some((r) => filled[r.id])
      ? { ...it, detail: { ...it.detail, rows: it.detail.rows.map((r) => (filled[r.id] ? { ...r, namaMurid: filled[r.id] } : r)) } }
      : it)),
  };
}

export default function ReservedNamesForm({ order, onSave }) {
  const [names, setNames] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // { order, jenisPlak }: the preview as of the last Preview crystal click
  const [preview, setPreview] = useState(null);
  const rows = (order?.items || []).flatMap((it) => (Array.isArray(it.detail?.rows) ? it.detail.rows : [])
    .filter((r) => r.id && isReservedName(r.namaMurid))
    .map((r) => ({ ...r, category: resolveCategory(it.categoryKey)?.label || it.categoryKey, jenisPlak: r.jenisPlak || it.jenisPlak })));
  if (order?.status !== 'In Production' || rows.length === 0) return null;

  const hasCrystal = rows.some((r) => isCrystalCode(r.jenisPlak));
  const filled = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v && !isReservedName(v)));
  const save = async () => {
    setBusy(true);
    setMessage('');
    const err = await onSave(filled);
    setBusy(false);
    if (err) { setMessage(err); return; }
    setNames({});
    setPreview(null);
    setMessage('Saved.');
  };

  return (
    <div className="card no-print" style={{ borderColor: '#d98c00', margin: 'var(--space-4) 0' }}>
      <div className="card-kicker" style={{ color: '#b45309' }}>Reserved names — fill in</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        These plaques are still &quot;Reserved&quot;. Type each real name and Save. Once none is left, the order leaves KIV &amp; ARTWORK and goes to Typing.
      </p>
      <table className="table">
        <thead><tr><th>Category</th><th>Jenis Plak</th><th>Award</th><th>Qty</th><th>Nama Murid</th>{hasCrystal && <th aria-label="Preview" />}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.category}</td>
              <td>{r.jenisPlak || '—'}</td>
              <td>{r.desc || '—'}</td>
              <td>{r.qty}</td>
              <td>
                <input
                  className="input" value={names[r.id] || ''} placeholder={r.namaMurid}
                  aria-label={`Name for ${r.desc || 'this plaque'}`}
                  onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))}
                />
              </td>
              {hasCrystal && (
                <td>
                  {isCrystalCode(r.jenisPlak) && (
                    <button
                      type="button" className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}
                      disabled={!filled[r.id]}
                      title={filled[r.id] ? 'See this crystal with the name typed here' : 'Type the name first'}
                      onClick={() => setPreview({ order: withTypedNames(order, filled), jenisPlak: r.jenisPlak })}
                    >
                      Preview crystal
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }} disabled={busy || Object.keys(filled).length === 0} onClick={save}>
        {busy ? 'Saving…' : `Save ${Object.keys(filled).length || ''} name(s)`}
      </button>
      {preview && (
        <>
          <p className="hint-text" style={{ marginBottom: 0 }}>
            Preview only — the names are not saved until you click Save. Changed a name? Click Preview crystal again.
          </p>
          <CrystalPreview order={preview.order} role="view" showArtwork={false} selected={preview.jenisPlak} />
        </>
      )}
      {message && <p className="hint-text" style={{ color: message === 'Saved.' ? '#2f6b4f' : '#b91c1c', fontWeight: 600 }}>{message}</p>}
    </div>
  );
}
