import { useState } from 'react';
import PriceTable from './PriceTable';
import { useAppState } from '../state/useAppState';
import { standardUnitPrice } from '../data/catalog';

// Production changes prices while reviewing an order or its Tambahan (Sean,
// 2026-10-09) — one line per item, so e.g. only the plaques carrying a
// student's name get the extra RM1. Saved by AppState's saveProductionPrices.

// What's engraved on a one-row item (TOKOH / ORDER LAIN-LAIN / LONJAKAN), so
// Production can tell which line carries a name: its NAMA MURID, else its
// own ①–④ lines, else the row's description.
const rowText = (it) => {
  const r = it.detail?.rows?.length === 1 ? it.detail.rows[0] : null;
  if (!r) return '';
  if (r.namaMurid) return r.namaMurid;
  const lines = [r.l0, r.l1, r.l2, r.l3].filter((v) => v && v !== '-');
  return lines.length ? lines.join(' · ') : (r.desc || '');
};

export default function ProductionPriceEditor({ order, addOn = false }) {
  const { state, saveProductionPrices } = useAppState();
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const items = (addOn ? order.pendingAddonItems : order.items) || [];
  const rows = items.map((it) => {
    const unitPrice = Number(drafts[it.id] ?? it.unitPrice ?? 0);
    const text = rowText(it);
    return { ...it, categoryLabel: text ? `${it.categoryLabel} — ${text}` : it.categoryLabel, unitPrice, harga: unitPrice * (Number(it.qty) || 0) };
  });
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);
  const changed = Object.keys(drafts).length > 0;

  const setPrice = (ids, value) => setDrafts((prev) => {
    const next = { ...prev };
    ids.forEach((id) => { next[id] = value; });
    return next;
  });

  const save = async () => {
    setSaving(true);
    const res = await saveProductionPrices(order.id, drafts, { addOn });
    setSaving(false);
    if (!res.ok) { setMessage({ ok: false, text: res.message }); return; }
    setDrafts({});
    setMessage({ ok: true, text: 'Prices saved.' });
  };

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <p className="hint-text" style={{ margin: '0 0 var(--space-2)' }}>
        Change Price per Unit on any line (e.g. +RM1 for a plaque with a student’s name), then Save Prices.
        Changed prices show in red with the old price beside them; the salesman can still change them when approving.
        Do Edit Order first — saving Edit Order resets prices to the website price list.
      </p>
      <PriceTable
        rows={rows} editable priceDrafts={drafts} setPrice={setPrice} plakCatalog={state.plakCatalog}
        totalQty={totalQty} totalHarga={totalHarga}
        priceAdjusted={rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog))}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" disabled={!changed || saving} onClick={save}>{saving ? 'Saving…' : 'Save Prices'}</button>
        {changed && <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => { setDrafts({}); setMessage(null); }}>Undo changes</button>}
        {message && <span className="hint-text" style={{ color: message.ok ? '#1f8a3b' : '#c0392b', fontWeight: 600 }}>{message.text}</span>}
      </div>
    </div>
  );
}
