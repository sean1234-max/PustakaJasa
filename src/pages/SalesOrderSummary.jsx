import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import PriceTable from '../components/PriceTable';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, standardUnitPrice, formatDate } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getOrderCategories } from '../utils/exportCsv';

// Read-only everywhere — this page only ever displays what the teacher
// already submitted, it never edits the underlying order/category data.
const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false, namaKelas: false };

export default function SalesOrderSummary() {
  const { state, approveOrder, approveAddOn, rejectAddOn } = useAppState();
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

  // Same pattern as priceDrafts above, but for a pending add-on's items —
  // lets Sales adjust pricing before approving it into the order, the same
  // way they can for the original order.
  const [addOnPriceDrafts, setAddOnPriceDrafts] = useState(() => {
    const out = {};
    (order?.pendingAddonItems || []).forEach((it) => {
      out[it.id] = it.unitPrice ?? standardUnitPrice(it.jenisPlak, state.plakCatalog) ?? 0;
    });
    return out;
  });
  const [rejectReason, setRejectReason] = useState('');

  const rows = useMemo(() => (order?.items || []).map((it) => {
    const unitPrice = Number(priceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [order, priceDrafts]);

  const addOnRows = useMemo(() => (order?.pendingAddonItems || []).map((it) => {
    const unitPrice = Number(addOnPriceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [order, addOnPriceDrafts]);

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);

  // Printing needs every category's details at once, not just whichever
  // tab happens to be open on screen — the tab UI is for browsing, the
  // printout is the full order. Kept grouped per category (rather than
  // flattened) so the print layout can force a page break between
  // categories without losing track of which blocks belong together.
  const catBlockGroups = useMemo(() => {
    if (!order) return [];
    return categories.map((cat) => ({
      cat,
      blocks: reconstructBlocksForCategory(order, cat.key, state.plakCatalog).blocks,
    }));
  }, [order, categories, state.plakCatalog]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  const addOnTotalQty = addOnRows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const addOnTotalHarga = addOnRows.reduce((sum, it) => sum + it.harga, 0);

  const setPrice = (itemId, value) => setPriceDrafts((prev) => ({ ...prev, [itemId]: value }));
  const setAddOnPrice = (itemId, value) => setAddOnPriceDrafts((prev) => ({ ...prev, [itemId]: value }));

  // Stays on this page after approving (instead of bouncing back to the
  // dashboard) so Sales can immediately print the now-approved order —
  // the page re-renders read-only once order.status flips, and the Print
  // button takes its place where Approve was.
  const handleApprove = () => {
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    approveOrder(order.id, updatedItems);
  };

  const handleApproveAddOn = () => {
    approveAddOn(order.id, addOnRows.map((r) => ({ ...r })));
  };

  const handleRejectAddOn = () => {
    rejectAddOn(order.id, rejectReason.trim());
    setRejectReason('');
  };

  const handlePrint = () => window.print();

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

        <div className="screen-only">
          {page === 'summary' ? (
            <>
              <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
                {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
                {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
                {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
                {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
                {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
                {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
                {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
              </div>

              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
              <PriceTable
                rows={rows} editable={editable} priceDrafts={priceDrafts} setPrice={setPrice}
                plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
              />

              {order.pendingAddonStatus === 'pending' && (
                <>
                  <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Tambahan — Pending Approval</div>
                  <p className="hint-text" style={{ marginTop: 0 }}>Adjust pricing if needed, then approve to add these into the order, or reject to send it back to the teacher.</p>
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
                      {addOnRows.map((it) => (
                        <tr key={it.id}>
                          <td>{it.categoryLabel}</td>
                          <td>{it.jenisPlak}</td>
                          <td>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="0.01"
                              value={addOnPriceDrafts[it.id]}
                              onChange={(e) => setAddOnPrice(it.id, e.target.value)}
                            />
                          </td>
                          <td>{it.qty}</td>
                          <td><strong>RM {it.harga.toFixed(2)}</strong></td>
                        </tr>
                      ))}
                      <tr><td /><td /><td /><td><strong>SUBTOTAL</strong></td><td><strong>RM {addOnTotalHarga.toFixed(2)}</strong></td></tr>
                    </tbody>
                  </table>
                  <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>QTY total: {addOnTotalQty}</p>

                  <div className="field" style={{ maxWidth: 420, marginTop: 'var(--space-4)' }}>
                    <label htmlFor="rejectReason">Reason for rejecting (optional, shown to the teacher)</label>
                    <input className="input" id="rejectReason" placeholder="e.g. please confirm quantity for X" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  </div>
                  <div className="row-split" style={{ marginTop: 'var(--space-4)' }}>
                    <button type="button" className="btn btn-ghost" onClick={handleRejectAddOn}>Reject</button>
                    <button type="button" className="btn btn-primary" onClick={handleApproveAddOn}>Approve Add-On</button>
                  </div>
                </>
              )}
              {order.pendingAddonStatus === 'rejected' && (
                <div className="login-error" style={{ marginTop: 'var(--space-6)' }}>
                  You rejected this add-on{order.pendingAddonRejectReason ? `: ${order.pendingAddonRejectReason}` : '.'} Waiting for the teacher to cancel or resubmit it.
                </div>
              )}

              <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPage('details')}>View Order Details →</button>
                {editable
                  ? <button type="button" className="btn btn-primary" onClick={handleApprove}>Approve</button>
                  : <button type="button" className="btn btn-primary" onClick={handlePrint}>Print Order</button>}
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

        {/* Print-only: combines the summary price table and every category's
            full details into one printout, regardless of which tab is open
            on screen — see the "Print Order" button, only shown once approved. */}
        <div className="print-only">
          <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
            {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
            {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
            {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
            {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
            {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
            {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
            {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
          </div>

          <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
          <PriceTable
            rows={rows} editable={false} priceDrafts={priceDrafts} setPrice={setPrice}
            plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
          />

          {categories.length > 0 && (
            <div className="print-details-section">
              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Order Details</div>
              {catBlockGroups.map(({ cat, blocks }, catIdx) => (
                <div
                  key={cat.key}
                  className={`print-category-page${catIdx > 0 ? ' print-category-break' : ''}`}
                >
                  {blocks.map((blk, i) => (
                    <OrderCategoryBlock key={i} blk={blk} editable={READONLY} refImageUrl={state.refImages?.[blk.sampleSlotId]} hideEmptyRows />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
