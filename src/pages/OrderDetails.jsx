import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import PriceTable from '../components/PriceTable';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, statusPillStyle, formatDate, formatDateTime, standardUnitPrice } from '../data/catalog';
import CancelOrderControl from '../components/CancelOrderControl';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { splitOrderCategories } from '../utils/exportCsv';
import { getInvoiceItems } from '../utils/orderBatches';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

export default function OrderDetails() {
  const { state, recordPrint, ensureOrderLoaded } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const order = state.orders.find((o) => o.id === id);
  const [page, setPage] = useState('summary');

  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Opened from one specific invoice's card on My Orders (a split order
  // shows one card per invoice, see Dashboard.jsx/getOrderInvoiceSlices) —
  // ?invoice= says which one, so this page only shows (and totals) that
  // invoice's own Jenis Plak instead of mixing every invoice's plaques
  // into one page no matter which card was opened. Absent, or on an
  // un-split order (no invoiceGroups to slice by), shows everything — same
  // as before this existed.
  const viewInvoiceId = searchParams.get('invoice') || null;
  const isFiltered = !!viewInvoiceId && !!(order?.invoiceGroups || []).length;
  const sliceStatus = isFiltered
    ? (order.invoiceGroups || []).find((g) => g.invoiceId === viewInvoiceId)?.status || order.status
    : order?.status;

  // Always read-only here (a teacher never edits pricing) — items already
  // carry their approved (or, before approval, catalog-standard) unitPrice.
  // getInvoiceItems cuts a partly-split Jenis Plak (e.g. 5 of 15 PKC 263 on
  // a second invoice) down to just this invoice's QTY / Harga.
  const priceRows = useMemo(() => {
    if (!order) return [];
    if (!isFiltered) return order.items;
    return getInvoiceItems(order, viewInvoiceId);
  }, [order, isFiltered, viewInvoiceId]);

  const { anugerah: allCategories, selempang: allSelempangCats } = useMemo(
    () => (order ? splitOrderCategories(order) : { anugerah: [], selempang: [] }),
    [order],
  );
  // Drops a category entirely once none of ITS items are on this invoice —
  // no point showing an empty tab. A block within a surviving category
  // that mixes Jenis Plak across invoices (rare — matrix-style categories
  // can) is left as-is rather than risk splitting it wrong; only a block
  // whose own single `jenisPlak` clearly belongs to a different invoice is
  // dropped below.
  const categories = useMemo(() => {
    if (!isFiltered) return allCategories;
    return allCategories.filter((cat) => priceRows.some((it) => it.categoryKey === cat.key));
  }, [allCategories, isFiltered, priceRows]);
  const selempangCats = useMemo(() => {
    if (!isFiltered) return allSelempangCats;
    return allSelempangCats.filter((cat) => priceRows.some((it) => it.categoryKey === cat.key));
  }, [allSelempangCats, isFiltered, priceRows]);
  // A partly-split Jenis Plak has items on both invoices, so its block shows on both.
  const filterBlocks = useCallback((blocks) => (!isFiltered ? blocks : blocks.filter((blk) => (
    !blk.jenisPlak || priceRows.some((it) => it.jenisPlak === blk.jenisPlak)
  ))), [isFiltered, priceRows]);
  const selempangBlocks = useMemo(() => {
    if (!order) return [];
    return filterBlocks(selempangCats.flatMap((cat) => reconstructBlocksForCategory(order, cat.key, state.plakCatalog).blocks));
  }, [order, selempangCats, state.plakCatalog, filterBlocks]);

  // Printing needs every category's details at once, not just whichever
  // tab happens to be open on screen — same pattern as SalesOrderSummary.
  const catBlockGroups = useMemo(() => {
    if (!order) return [];
    return [...categories, ...selempangCats].map((cat) => ({
      cat,
      blocks: filterBlocks(reconstructBlocksForCategory(order, cat.key, state.plakCatalog).blocks),
    }));
  }, [order, categories, selempangCats, state.plakCatalog, filterBlocks]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(sliceStatus);
  const invoiceIdLabel = idx >= 1 ? (viewInvoiceId || order.invoiceId || `INV-${order.id.replace('ORD-', '')}`) : '-';

  const totalQty = priceRows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = priceRows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || priceRows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  // Deferred a tick so the just-updated printedAt (set by recordPrint,
  // React state) has actually re-rendered into the print-only DOM before
  // window.print() reads it — calling window.print() synchronously right
  // after the state update isn't guaranteed to see the new render yet.
  const handlePrint = () => { recordPrint(order.id); setTimeout(() => window.print(), 0); };

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
          <span className="status-pill" style={statusPillStyle(sliceStatus)}>{sliceStatus}</span>
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
                <div><div className="dim">Total Amount</div><div className={priceAdjusted ? 'amount-adjusted' : undefined}>RM {totalHarga.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>
              </div>

              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Function Details</div>
              <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
                {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
                {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
                {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}</div></div>}
                {order.phone && <div><div className="dim">Phone Number</div><div>{order.phone}</div></div>}
                {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
                {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
                {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(new Date(order.shipmentDate))}</div></div>}
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

              {order.status === 'Submitted to Sales' && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <div className="card-kicker">Cancel</div>
                  <p className="hint-text" style={{ marginTop: 0 }}>You can cancel this order yourself only while it is still awaiting Sales review.</p>
                  <CancelOrderControl order={order} onCancelled={() => navigate('/dashboard')} />
                </div>
              )}

              <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
                <button type="button" className="btn btn-ghost" onClick={handlePrint}>Print Order</button>
                <button type="button" className="btn btn-primary" onClick={() => setPage('details')}>Next: Order Details →</button>
              </div>
            </>
          ) : (
            <>
              {/* Only SELEMPANG shows its rows in Order Details — Sean's rule for every
                  role; other categories' details stay off this screen. */}
              {selempangBlocks.length === 0 ? (
                <p className="hint-text" style={{ marginTop: 'var(--space-3)' }}>Only SELEMPANG orders show order details.</p>
              ) : selempangBlocks.map((blk) => (
                <OrderCategoryBlock key={`sel-${blk.idx}`} blk={blk} editable={READONLY} />
              ))}

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
          {/* Bigger, easier-to-read type just for the Summary half — see
              SalesOrderSummary.jsx's identical .print-summary-section. */}
          <div className="print-summary-section">
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              <div><div className="dim">Order ID</div><div>{order.id}</div></div>
              <div><div className="dim">Invoice Number</div><div>{viewInvoiceId || order.invoiceId || '-'}</div></div>
              {order.printedAt && <div><div className="dim">Order Printed</div><div>{formatDateTime(order.printedAt)}</div></div>}
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {/* Printed with Shipment Date directly above Function Date (one cell),
                  not side by side across the two-column grid. */}
              {(order.shipmentDate || order.functionDate) && (
                <div>
                  {order.shipmentDate && <><div className="dim">Shipment Date</div><div>{formatDate(new Date(order.shipmentDate))}</div></>}
                  {order.functionDate && <><div className="dim" style={order.shipmentDate ? { marginTop: 'var(--space-2)' } : undefined}>Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></>}
                </div>
              )}
            </div>

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
            <PriceTable
              rows={priceRows} editable={false} priceDrafts={{}} setPrice={() => {}}
              plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
            />
          </div>

          {catBlockGroups.length > 0 && (
            <div className="print-details-section">
              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Order Details</div>
              {catBlockGroups.map(({ cat, blocks }, catIdx) => (
                <div
                  key={cat.key}
                  className={`print-category-page${catIdx > 0 ? ' print-category-break' : ''}`}
                >
                  {blocks.map((blk, i) => (
                    <OrderCategoryBlock key={i} blk={blk} editable={READONLY} hideEmptyRows />
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
