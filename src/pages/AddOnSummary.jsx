import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { CATEGORIES, getStockStatus, formatDate, toMalaysiaDay, categoriesUsedByItems, isDynamicCategoryKey } from '../data/catalog';
import { computeBlocks, noopUpdaters } from '../utils/computeBlocks';

// The add-on's cart (Sean, 2026-10-09): the same Order Summary as New
// Order's Cart for the original order, then TAMBAHAN below in the same form.

// One row per (category, Jenis Plak), like Cart.jsx.
const groupRows = (items) => {
  const byKey = new Map();
  items.forEach((it) => {
    const key = `${it.categoryLabel}::${it.jenisPlak}`;
    const row = byKey.get(key) || { key, categoryLabel: it.categoryLabel, jenisPlak: it.jenisPlak, qty: 0, harga: 0 };
    byKey.set(key, { ...row, qty: row.qty + (Number(it.qty) || 0), harga: row.harga + (Number(it.harga) || 0) });
  });
  return [...byKey.values()];
};

function SummaryTable({ title, rows, totalQty, totalHarga, isOverStock = () => false, onEdit }) {
  return (
    <>
      <div className="card-kicker">{title}</div>
      <table className="table" style={{ margin: 'var(--space-3) 0 var(--space-6)' }}>
        <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th><th style={{ width: 48 }} /></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.categoryLabel}</td>
              <td>{row.jenisPlak || '—'}</td>
              <td style={isOverStock(row) ? { color: '#c0392b', fontWeight: 700 } : undefined}>{row.qty}</td>
              <td>RM {row.harga.toFixed(2)}</td>
              <td>{onEdit && <button type="button" className="btn btn-ghost btn-icon" aria-label="Edit" title="Edit the add-on" onClick={onEdit}>✎</button>}</td>
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
  const { state, submitPendingAddOn } = useAppState();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const order = state.orders.find((o) => o.id === state.addOnOrderId);

  // Enumerates every category's block(s) currently held in the Add On
  // draft — mirrors submitPendingAddOn's own item-building loop
  // (src/state/AppState.jsx) so this preview always matches exactly what
  // that function is about to submit.
  const addOnSummaryItems = useMemo(() => {
    const items = [];
    // A renamed/duplicated template sheet from the original order's own
    // import has no entry in the static CATEGORIES list — see
    // submitPendingAddOn's matching fix in AppState.jsx (this preview must
    // mirror it exactly, per the comment above).
    const dynamicCats = order ? categoriesUsedByItems(order.items).filter((c) => isDynamicCategoryKey(c.key)) : [];
    [...CATEGORIES, ...dynamicCats].forEach((cat) => {
      const { blocks } = computeBlocks(cat.key, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, noopUpdaters, state.plakCatalog, state.schoolLanguage);
      blocks.forEach((blk) => {
        if (blk.selempang) {
          const rows = (blk.rows || []).filter((r) => Number(r.qty) > 0);
          if (rows.length === 0) return;
          const qty = rows.reduce((s, r) => s + Number(r.qty), 0);
          items.push({ jenisPlak: 'SELEMPANG', qty, harga: qty * (blk.selempangUnitPrice || 0), categoryLabel: cat.label });
          return;
        }
        blk.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) items.push({ jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, categoryLabel: blk.qtyLabel });
        });
      });
    });
    return items;
  }, [order, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, state.plakCatalog, state.schoolLanguage]);

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

  const originalItems = order.items.map((it) => ({ jenisPlak: it.jenisPlak, qty: it.qty, harga: it.harga, categoryLabel: it.categoryLabel }));
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
          onEdit={() => navigate(`/addon/${order.id}`)}
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
          <button type="button" className="btn btn-primary" disabled={submitting || !!stockViolation} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit Tambahan'}
          </button>
        </div>
      </div>
    </div>
  );
}
