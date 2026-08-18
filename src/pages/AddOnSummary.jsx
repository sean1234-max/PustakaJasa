import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { CATEGORIES } from '../data/catalog';
import { computeBlocks, noopUpdaters } from '../utils/computeBlocks';

export default function AddOnSummary() {
  const { state, submitPendingAddOn } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.addOnOrderId);

  const addOnSummaryItems = useMemo(() => {
    const items = [];
    CATEGORIES.forEach((cat) => {
      const pbdV = cat.key === 'PBD' ? state.addOnPbdVariant : 0;
      const { blocks } = computeBlocks(cat.key, pbdV, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, [], noopUpdaters, state.plakCatalog, state.schoolLanguage);
      blocks.forEach((blk) => {
        blk.plakRows.forEach((pr) => {
          if (pr.jenisPlak && pr.qty) items.push({ jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, categoryLabel: blk.qtyLabel });
        });
      });
    });
    return items;
  }, [state.addOnPbdVariant, state.addOnLineValues, state.addOnMatrixValues, state.addOnRowsByBlock, state.addOnPlakRows, state.plakCatalog, state.schoolLanguage]);

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
            {addOnSummaryItems.map((it, i) => <tr key={i}><td>{it.categoryLabel}</td><td>{it.jenisPlak}</td><td>{it.qty}</td><td>RM {it.harga.toFixed(2)}</td></tr>)}
            {addOnSummaryItems.length === 0 && <tr><td colSpan={4} style={{ textAlign: 'center', opacity: 0.5, padding: 'var(--space-4)' }}>No add-on items yet.</td></tr>}
            <tr><td /><td><strong>SUBTOTAL</strong></td><td><strong>{addOnTotalQty}</strong></td><td><strong>RM {addOnTotalHarga.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        <div className="combined-total">
          <span className="dim">Estimated Total After Approval:</span> <strong>RM {(originalTotalHarga + addOnTotalHarga).toFixed(2)}</strong>
        </div>

        <div className="row-split">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/addon/${order.id}`)}>← Back to Edit</button>
          <button type="button" className="btn btn-primary" onClick={() => { submitPendingAddOn(); navigate('/dashboard'); }}>Submit for Sales Approval</button>
        </div>
      </div>
    </div>
  );
}
