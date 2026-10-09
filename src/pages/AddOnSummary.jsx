import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { getStockStatus, formatDate, toMalaysiaDay, resolveCategory } from '../data/catalog';

// The add-on's cart (Sean, 2026-10-09): the same Order Summary as New
// Order's Cart for the original order, then TAMBAHAN below in the same form.

// One row per (category, Jenis Plak), like Cart.jsx.
const groupRows = (items) => {
  const byKey = new Map();
  items.forEach((it) => {
    const key = `${it.categoryLabel}::${it.jenisPlak}`;
    const row = byKey.get(key) || { key, categoryLabel: it.categoryLabel, jenisPlak: it.jenisPlak, qty: 0, harga: 0, ids: [] };
    byKey.set(key, { ...row, qty: row.qty + (Number(it.qty) || 0), harga: row.harga + (Number(it.harga) || 0), ids: [...row.ids, it.id] });
  });
  return [...byKey.values()];
};

function SummaryTable({ title, rows, totalQty, totalHarga, isOverStock = () => false, onRemove }) {
  return (
    <>
      <div className="card-kicker">{title}</div>
      <table className="table" style={{ margin: 'var(--space-3) 0 var(--space-6)' }}>
        <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th><th style={{ width: 44 }} /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.categoryLabel}</td>
              <td>{row.jenisPlak || '—'}</td>
              <td style={isOverStock(row) ? { color: '#c0392b', fontWeight: 700 } : undefined}>{row.qty}</td>
              <td>RM {row.harga.toFixed(2)}</td>
              <td>{onRemove && <button type="button" className="btn btn-ghost btn-icon" aria-label="Remove" onClick={() => onRemove(row.ids)}>✕</button>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', opacity: 0.5, padding: 'var(--space-4)' }}>No items yet.</td></tr>}
          <tr><td><strong>TOTAL</strong></td><td /><td><strong>{totalQty}</strong></td><td><strong>RM {totalHarga.toFixed(2)}</strong></td><td /></tr>
        </tbody>
      </table>
    </>
  );
}

export default function AddOnSummary() {
  const { state, submitPendingAddOn, removeFromAddOnCart } = useAppState();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const order = state.orders.find((o) => o.id === state.addOnOrderId);

  // Exactly what submitPendingAddOn will submit (AppState's addOnAddToCart).
  const addOnSummaryItems = useMemo(() => state.addOnCart.map((ci) => ({
    id: ci.id, jenisPlak: ci.jenisPlak, qty: ci.qty, harga: ci.harga,
    categoryLabel: resolveCategory(ci.categoryKey)?.label || ci.categoryLabel,
  })), [state.addOnCart]);

  const stockViolation = useMemo(() => addOnSummaryItems
    .map((it) => {
      const status = getStockStatus(it.jenisPlak, state.plakCatalog);
      return status && Number(it.qty) > status.maxOrderable ? { ...it, maxOrderable: status.maxOrderable } : null;
    })
    .find(Boolean), [addOnSummaryItems, state.plakCatalog]);

  const handleSubmit = async () => {
    if (submitting || stockViolation) return;
    setSubmitting(true);
    const ok = await submitPendingAddOn();
    setSubmitting(false);
    if (ok) navigate(state.role === 'salesman' ? `/sales/orders/${order.id}` : '/dashboard');
  };

  if (!order) return null;

  const originalItems = order.items.map((it) => ({ jenisPlak: it.jenisPlak, qty: it.qty, harga: it.harga, categoryLabel: resolveCategory(it.categoryKey)?.label || it.categoryLabel }));
  const originalTotalQty = originalItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const originalTotalHarga = originalItems.reduce((sum, it) => sum + it.harga, 0);
  const addOnTotalQty = addOnSummaryItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const addOnTotalHarga = addOnSummaryItems.reduce((sum, it) => sum + it.harga, 0);

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Review Order — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Summary</div>

        <div className="form-grid-2 cart-summary-grid">
          <div className="summary-col">
            <div><span className="dim">SALES :</span> {order.sales}</div>
            <div><span className="dim">SEKOLAH :</span> {order.sekolah}</div>
            <div><span className="dim">LOGO TYPE :</span> {order.schoolType === 'NOT_SK' ? 'Others' : 'SK'}</div>
            <div><span className="dim">CIKGU / NO TEL :</span> {order.picName}{order.phone ? ` / ${order.phone}` : ''}</div>
            <div><span className="dim">KETUA PANITIA :</span> {order.ketuaPanitia}</div>
          </div>
          <div className="summary-col">
            <div><span className="dim">TARIKH ORDER :</span> {order.datePlaced}</div>
            <div><span className="dim">TARIKH FUNCTION :</span> {order.functionDate ? formatDate(toMalaysiaDay(order.functionDate)) : '—'}</div>
            <div><span className="dim">TERMS :</span> {order.terms}</div>
          </div>
        </div>

        <SummaryTable title="Anugerah — Category / Jenis Plak / QTY / Harga" rows={groupRows(originalItems)} totalQty={originalTotalQty} totalHarga={originalTotalHarga} />

        <div className="print-tambahan-banner" style={{ margin: 'var(--space-8) 0 var(--space-4)' }}>TAMBAHAN</div>
        <p className="hint-text" style={{ marginTop: 0 }}>
          These add-on items won&apos;t be added to the order yet — Production reviews them, then Sales approves them (they may adjust pricing).
        </p>
        <SummaryTable
          title="Tambahan — Category / Jenis Plak / QTY / Harga" rows={groupRows(addOnSummaryItems)} totalQty={addOnTotalQty} totalHarga={addOnTotalHarga}
          isOverStock={(row) => { const st = getStockStatus(row.jenisPlak, state.plakCatalog); return !!st && row.qty > st.maxOrderable; }}
          onRemove={removeFromAddOnCart}
        />

        <table className="table" style={{ margin: '0 0 var(--space-8)' }}>
          <tbody>
            <tr><td><strong>GRAND TOTAL (Original + Tambahan)</strong></td><td style={{ width: 110 }}><strong>{originalTotalQty + addOnTotalQty}</strong></td><td style={{ width: 130 }}><strong>RM {(originalTotalHarga + addOnTotalHarga).toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        {stockViolation && (
          <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>
            Stock tidak cukup untuk &quot;{stockViolation.jenisPlak}&quot; — baki {stockViolation.maxOrderable} sahaja boleh ditempah. Sila kurangkan kuantiti atau hubungi Salesman sebelum submit.
          </p>
        )}
        <div className="row-split">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/addon/${order.id}`)}>← Back to Add On</button>
          <button type="button" className="btn btn-primary" disabled={submitting || !!stockViolation || addOnSummaryItems.length === 0} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit Tambahan'}
          </button>
        </div>
      </div>
    </div>
  );
}
