import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { computeBlocks, noopUpdaters } from '../utils/computeBlocks';

export default function AmendSummary() {
  const { state, updateAmend } = useAppState();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === state.amendOrderId);

  const amendSummaryItems = useMemo(() => {
    const items = [];
    state.amendCategoriesUsed.forEach((catKey) => {
      const { blocks } = computeBlocks(catKey, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, noopUpdaters, state.plakCatalog, state.schoolLanguage);
      blocks.forEach((blk) => {
        blk.plakRows.forEach((pr) => {
          if (pr.jenisPlak) items.push({ jenisPlak: pr.jenisPlak, qty: pr.qty, harga: pr.rawHarga, categoryLabel: blk.qtyLabel });
        });
      });
    });
    return items;
  }, [state.amendCategoriesUsed, state.amendLineValues, state.amendMatrixValues, state.amendRowsByBlock, state.amendPlakRows, state.amendColumnsByBlock, state.plakCatalog, state.schoolLanguage]);

  const totalQty = amendSummaryItems.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = amendSummaryItems.reduce((sum, it) => sum + it.harga, 0);

  if (!order) return null;

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Amend Order — {order.id}</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Review Changes</div>

        <table className="table" style={{ marginBottom: 'var(--space-6)' }}>
          <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Harga</th></tr></thead>
          <tbody>
            {amendSummaryItems.map((it, i) => (
              <tr key={i}><td>{it.categoryLabel}</td><td>{it.jenisPlak}</td><td>{it.qty}</td><td>RM {it.harga.toFixed(2)}</td></tr>
            ))}
            <tr><td /><td><strong>TOTAL</strong></td><td><strong>{totalQty}</strong></td><td><strong>RM {totalHarga.toFixed(2)}</strong></td></tr>
          </tbody>
        </table>

        <div className="row-split">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(`/amend/${order.id}`)}>← Back to Edit</button>
          <button type="button" className="btn btn-primary" onClick={() => { updateAmend(); navigate('/dashboard'); }}>Update</button>
        </div>
      </div>
    </div>
  );
}
