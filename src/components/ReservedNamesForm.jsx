// Filling in "Reserved" names on an order already In Production (Sean, 2026-10-17): Production
// or the order's salesman types each real name; once none is left the KIV card leaves KIV &
// ARTWORK on its own (0097 fill_reserved_names). A row left blank stays Reserved.
import { useState } from 'react';
import { isReservedName } from '../utils/exportCsv';
import { resolveCategory } from '../data/catalog';

export default function ReservedNamesForm({ order, onSave }) {
  const [names, setNames] = useState({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const rows = (order?.items || []).flatMap((it) => (Array.isArray(it.detail?.rows) ? it.detail.rows : [])
    .filter((r) => r.id && isReservedName(r.namaMurid))
    .map((r) => ({ ...r, category: resolveCategory(it.categoryKey)?.label || it.categoryKey, jenisPlak: r.jenisPlak || it.jenisPlak })));
  if (order?.status !== 'In Production' || rows.length === 0) return null;

  const filled = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v && !isReservedName(v)));
  const save = async () => {
    setBusy(true);
    setMessage('');
    const err = await onSave(filled);
    setBusy(false);
    if (err) { setMessage(err); return; }
    setNames({});
    setMessage('Saved.');
  };

  return (
    <div className="card no-print" style={{ borderColor: '#d98c00', margin: 'var(--space-4) 0' }}>
      <div className="card-kicker" style={{ color: '#b45309' }}>Reserved names — fill in</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        These plaques are still &quot;Reserved&quot;. Type each real name and Save. Once none is left, the order leaves KIV &amp; ARTWORK and goes to Typing.
      </p>
      <table className="table">
        <thead><tr><th>Category</th><th>Jenis Plak</th><th>Award</th><th>Qty</th><th>Nama Murid</th></tr></thead>
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
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-primary" style={{ marginTop: 'var(--space-3)' }} disabled={busy || Object.keys(filled).length === 0} onClick={save}>
        {busy ? 'Saving…' : `Save ${Object.keys(filled).length || ''} name(s)`}
      </button>
      {message && <p className="hint-text" style={{ color: message === 'Saved.' ? '#2f6b4f' : '#b91c1c', fontWeight: 600 }}>{message}</p>}
    </div>
  );
}
