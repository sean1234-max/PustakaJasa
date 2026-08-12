import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, standardUnitPrice } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getOrderCategories } from '../utils/exportCsv';

// Read-only everywhere — this page only ever displays what the teacher
// already submitted, it never edits the underlying order/category data.
const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false, namaKelas: false };

export default function SalesOrderSummary() {
  const { state, approveOrder } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  const editable = order?.status === 'Submitted to Sales';

  // Keyed by item.id — pre-filled from the item's current unit price (falls
  // back to the standard catalog rate for items that never had one, e.g.
  // hand-entered legacy orders) so editing never starts from a blank field.
  const [priceDrafts, setPriceDrafts] = useState(() => {
    const out = {};
    (order?.items || []).forEach((it) => {
      out[it.id] = it.unitPrice ?? standardUnitPrice(it.jenisPlak, state.plakCatalog) ?? 0;
    });
    return out;
  });
  const [page, setPage] = useState('summary');

  const rows = useMemo(() => (order?.items || []).map((it) => {
    const unitPrice = Number(priceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [order, priceDrafts]);

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);

  const setPrice = (itemId, value) => setPriceDrafts((prev) => ({ ...prev, [itemId]: value }));

  const handleApprove = () => {
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    approveOrder(order.id, updatedItems);
    navigate('/sales/dashboard');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/sales/dashboard')}>
        ← Back to Sales Orders
      </button>

      <div className="step-header">
        <div className={`step ${page === 'summary' ? 'step-active' : 'step-done'}`} style={{ cursor: 'pointer' }} onClick={() => setPage('summary')}>
          <div className="step-dot">{page === 'summary' ? '1' : '✓'}</div>
          <span>Summary</span>
        </div>
        <div className="step-line" />
        <div className={`step ${page === 'details' ? 'step-active' : 'step-upcoming'}`} style={{ cursor: 'pointer' }} onClick={() => setPage('details')}>
          <div className={`step-dot${page === 'details' ? '' : ' step-dot-outline'}`}>2</div>
          <span>Order Details</span>
        </div>
      </div>

      <div className="card elev-md">
        <div className="order-card-top" style={{ marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="card-kicker">{page === 'summary' ? 'Summary' : 'Order Details'}</div>
            <div className="card-title">{order.id}</div>
          </div>
          <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
        </div>

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
            </div>

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
            <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Jenis Plak</th>
                  <th style={{ width: 130 }}>Price per Unit</th>
                  <th style={{ width: 80 }}>QTY</th>
                  <th style={{ width: 130 }}>Harga</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((it) => {
                  const adjusted = it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog);
                  return (
                    <tr key={it.id}>
                      <td>{it.categoryLabel}</td>
                      <td>{it.jenisPlak}</td>
                      <td>
                        {editable ? (
                          <input
                            className={`input${adjusted ? ' amount-adjusted' : ''}`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={priceDrafts[it.id]}
                            onChange={(e) => setPrice(it.id, e.target.value)}
                          />
                        ) : (
                          <span className={adjusted ? 'amount-adjusted' : undefined}>RM {it.unitPrice.toFixed(2)}</span>
                        )}
                      </td>
                      <td>{it.qty}</td>
                      <td><strong className={adjusted ? 'amount-adjusted' : undefined}>RM {it.harga.toFixed(2)}</strong></td>
                    </tr>
                  );
                })}
                <tr>
                  <td /><td /><td /><td><strong>TOTAL</strong></td>
                  <td><strong className={order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog)) ? 'amount-adjusted' : undefined}>RM {totalHarga.toFixed(2)}</strong></td>
                </tr>
              </tbody>
            </table>
            <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>QTY total: {totalQty}</p>

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPage('details')}>View Order Details →</button>
              {editable && <button type="button" className="btn btn-primary" onClick={handleApprove}>Approve</button>}
            </div>
          </>
        ) : (
          <>
            {categories.length === 0 ? (
              <p className="hint-text" style={{ marginTop: 'var(--space-3)' }}>No category details found for this order.</p>
            ) : (
              <>
                <div style={{ margin: 'var(--space-3) 0' }}>
                  <CategoryTabs categories={categories} active={currentCat?.key} onSelect={setActiveCat} />
                </div>
                {catBlocks.map((blk) => (
                  <OrderCategoryBlock key={blk.idx} blk={blk} editable={READONLY} refImageUrl={state.refImages?.[blk.sampleSlotId]} />
                ))}
              </>
            )}

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPage('summary')}>← Back to Summary</button>
              <span />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
