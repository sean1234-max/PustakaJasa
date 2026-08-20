import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import PriceTable from '../components/PriceTable';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, formatDate, standardUnitPrice } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { getOrderCategories } from '../utils/exportCsv';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

export default function OrderDetails() {
  const { state } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  const [page, setPage] = useState('summary');

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);

  // Printing needs every category's details at once, not just whichever
  // tab happens to be open on screen — same pattern as SalesOrderSummary.
  const catBlockGroups = useMemo(() => {
    if (!order) return [];
    return categories.map((cat) => ({
      cat,
      blocks: reconstructBlocksForCategory(order, cat.key, state.plakCatalog).blocks,
    }));
  }, [order, categories, state.plakCatalog]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const invoiceIdLabel = idx >= 1 ? (order.invoiceId || `INV-${order.id.replace('ORD-', '')}`) : '-';

  // Always read-only here (a teacher never edits pricing) — items already
  // carry their approved (or, before approval, catalog-standard) unitPrice.
  const priceRows = order.items;
  const totalQty = priceRows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = priceRows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || priceRows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  const handlePrint = () => window.print();

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/dashboard')}>
        ← Back to My Orders
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
              <div className="order-dots" style={{ maxWidth: 260 }}>
                {STATUS_STAGES.map((_, i2) => (
                  <div key={i2} className="order-dot" style={{ background: i2 <= idx ? 'var(--color-accent-700)' : 'var(--color-neutral-300)' }} />
                ))}
              </div>

              {order.pendingAddonStatus === 'pending' && (
                <p className="hint-text" style={{ marginTop: 'var(--space-4)' }}>An add-on for this order is waiting for Sales approval.</p>
              )}
              {order.pendingAddonStatus === 'rejected' && (
                <div className="login-error" style={{ marginTop: 'var(--space-4)' }}>
                  Add-on rejected by Sales{order.pendingAddonRejectReason ? `: ${order.pendingAddonRejectReason}` : '.'}
                </div>
              )}

              <div className="form-grid-2" style={{ marginTop: 'var(--space-6)' }}>
                <div><div className="dim">Invoice ID</div><div>{invoiceIdLabel}</div></div>
                <div><div className="dim">Date Placed</div><div>{order.datePlaced}</div></div>
                <div><div className="dim">Est. Delivery</div><div>{order.deliveryDate}</div></div>
                <div><div className="dim">Total Amount</div><div className={order.priceAdjusted ? 'amount-adjusted' : undefined}>RM {order.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
              </div>

              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Function Details</div>
              <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
                {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
                {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
                {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}</div></div>}
                {order.phone && <div><div className="dim">Phone Number</div><div>{order.phone}</div></div>}
                {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
                {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
                {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
                {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
                {order.schoolType && <div><div className="dim">Logo Type</div><div>{order.schoolType === 'SK' ? 'SK' : 'Others'}</div></div>}
              </div>
              {order.logoDataUrl && (
                <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                  <label>Logo Type</label>
                  <img src={order.logoDataUrl} alt="" style={{ width: 52, height: 52, objectFit: 'contain', border: '1px solid var(--color-neutral-300)', background: '#fff' }} />
                </div>
              )}
              {order.logoRemark && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="dim">Remark (Please Specific Logo)</div>
                  <div>{order.logoRemark}</div>
                </div>
              )}
              {order.remark && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="dim">Remark</div>
                  <div>{order.remark}</div>
                </div>
              )}

              <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
                <button type="button" className="btn btn-ghost" onClick={handlePrint}>Print Order</button>
                <button type="button" className="btn btn-primary" onClick={() => setPage('details')}>Next: Order Details →</button>
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
                <button type="button" className="btn btn-primary" onClick={handlePrint}>Print Order</button>
              </div>
            </>
          )}
        </div>

        {/* Print-only: combines the function-details summary, the price
            table, and every category's full details into one printout,
            regardless of which tab is open on screen — see the "Print
            Order" button above. Same structure as SalesOrderSummary's
            print-only section. */}
        <div className="print-only">
          <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
            {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
            {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
            {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
            {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
            {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
            {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
          </div>

          <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
          <PriceTable
            rows={priceRows} editable={false} priceDrafts={{}} setPrice={() => {}}
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
