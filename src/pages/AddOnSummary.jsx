import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { CATEGORIES, getStockStatus } from '../data/catalog';
import { computeBlocks, noopUpdaters } from '../utils/computeBlocks';

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
    CATEGORIES.forEach((cat) => {
      const { blocks } = computeBlocks(cat.key, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, noopUpdaters, state.plakCatalog, state.schoolLanguage);
      blocks.forEach((blk) => {
        blk.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) items.push({ jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, categoryLabel: blk.qtyLabel });
        });
      });
    });
    return items;
  }, [state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.addOnColumnsByBlock, state.plakCatalog, state.schoolLanguage]);

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
    if (ok) navigate('/dashboard');
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
        <div className="card-kicker">Add On — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Order Summary</div>

        <div className="card-kicker">Original Order</div>
        <table className="table" style={{ margin: 'var(--space-3) 0 var(--space-6)' }}>
          <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
          <tbody>
            {originalItems.map((it, i) => <tr key={i}><td>{it.categoryLabel}</td><td>{it.jenisPlak}</td><td>{it.qty}</td><td>RM {it.harga.toFixed(2)}</td></tr>)}
            <tr><td /><td><strong>SUBTOTAL</strong></td><td><strong>{originalTotalQty}</strong></td><td><strong>RM {originalTotalHarga.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        <div className="card-kicker">Tambahan (Add-On)</div>
        <p className="hint-text" style={{ marginTop: 0 }}>
          These add-on items won&apos;t be added to the order yet — Sales needs to review and approve them first (they may adjust pricing).
        </p>
        <table className="table" style={{ margin: 'var(--space-3) 0 var(--space-6)' }}>
          <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
          <tbody>
            {addOnSummaryItems.map((it, i) => {
              const status = getStockStatus(it.jenisPlak, state.plakCatalog);
              const overStock = !!status && Number(it.qty) > status.maxOrderable;
              return (
                <tr key={i}>
                  <td>{it.categoryLabel}</td>
                  <td>{it.jenisPlak}</td>
                  <td style={overStock ? { color: '#c0392b', fontWeight: 700 } : undefined}>{it.qty}</td>
                  <td>RM {it.harga.toFixed(2)}</td>
                </tr>
              );
            })}
            {addOnSummaryItems.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.5, padding: 'var(--space-4)' }}>No add-on items yet.</td></tr>}
            <tr><td /><td><strong>SUBTOTAL</strong></td><td><strong>{addOnTotalQty}</strong></td><td><strong>RM {addOnTotalHarga.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        <div className="combined-total">
          <span className="dim">Estimated Total After Approval:</span> <strong>RM {(originalTotalHarga + addOnTotalHarga).toFixed(2)}</strong>
        </div>

        {stockViolation && (
          <p className="hint-text" style={{ color: '#c0392b', fontWeight: 600 }}>
            Stock tidak cukup untuk &quot;{stockViolation.jenisPlak}&quot; — baki {stockViolation.maxOrderable} sahaja boleh ditempah. Sila kurangkan kuantiti atau hubungi Salesman sebelum submit.
          </p>
        )}
        <div className="row-split">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/addon/${order.id}`)}>← Back to Edit</button>
          <button type="button" className="btn btn-primary" disabled={submitting || !!stockViolation} onClick={handleSubmit}>
            {submitting ? 'Submitting…' : 'Submit for Sales Approval'}
          </button>
        </div>
      </div>
    </div>
  );
}
