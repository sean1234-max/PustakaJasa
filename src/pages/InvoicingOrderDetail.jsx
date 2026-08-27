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
import { groupItemsByBatch } from '../utils/orderBatches';
import { getOrderChangeStamp } from '../utils/orderStamp';

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

// Invoicing Department's own order view — assigns/displays the Invoice
// Number and shows the original-vs-Tambahan breakdown (groupItemsByBatch,
// same helper SalesOrderSummary/ProductionOrderDetail already use).
//
// A Salesman sometimes hands Invoicing a paper hard copy of an order
// before ever clicking Approve in the system — receiving that hard copy
// already means they've agreed to it. So while an order is still
// "Submitted to Sales", this page lets Invoicing adjust pricing (same
// capability Sales would have had) and Approve + save the Invoice Number
// in one action (approveAndSetInvoiceId, src/state/AppState.jsx) — no
// separate Sales click needed. Once an order is already "In Production"
// (approved via either path), pricing is frozen and this page falls back
// to the simple invoice-only entry (setInvoiceId), same as before.
export default function InvoicingOrderDetail() {
  const { state, setInvoiceId, approveAndSetInvoiceId } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  const awaitingApproval = order?.status === 'Submitted to Sales';

  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [page, setPage] = useState('summary');

  // Same pattern as SalesOrderSummary's own priceDrafts — only meaningful
  // while awaitingApproval; a not-yet-approved order never has a Tambahan
  // batch yet, so PriceTable's own batch-grouping is a no-op here.
  const [priceDrafts, setPriceDrafts] = useState(() => {
    const out = {};
    (order?.items || []).forEach((it) => {
      out[it.id] = it.unitPrice ?? standardUnitPrice(it.jenisPlak, state.plakCatalog) ?? 0;
    });
    return out;
  });
  const rows = useMemo(() => (order?.items || []).map((it) => {
    const unitPrice = Number(priceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [order, priceDrafts]);
  const setPrice = (itemIds, value) => setPriceDrafts((prev) => {
    const next = { ...prev };
    itemIds.forEach((itemId) => { next[itemId] = value; });
    return next;
  });

  const categories = useMemo(() => (order ? getOrderCategories(order) : []), [order]);
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);

  if (!order) return null;

  const idx = STATUS_STAGES.indexOf(order.status);
  const stamp = getOrderChangeStamp(order);
  const itemGroups = groupItemsByBatch(order.items);
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  const handleSaveInvoice = () => {
    setInvoiceId(order.id, invoiceDraft);
    setInvoiceDraft('');
  };

  const handleApproveAndInvoice = () => {
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    approveAndSetInvoiceId(order.id, updatedItems, invoiceDraft);
    setInvoiceDraft('');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/invoicing/dashboard')}>
        ← Back to Invoicing
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {stamp && <span className="order-stamp-inline">{stamp}</span>}
            <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{order.status}</span>
          </div>
        </div>

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.sales && <div><div className="dim">Salesman</div><div>{order.sales}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {order.dueDate && <div><div className="dim">Due Date</div><div>{formatDate(new Date(order.dueDate))}</div></div>}
              {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
              <div><div className="dim">Order Date</div><div>{order.datePlaced}</div></div>
              <div><div className="dim">Total Amount</div><div>RM {order.totalAmount.toFixed(2)}</div></div>
            </div>
            {/* Not shown here before this — an import-derived note (a KIV
                line, a wording-only plaque parked here for now) landed in
                this SAME field but had nowhere to actually surface for
                Invoicing, so it went unseen until the teacher happened to
                mention it separately. See AppState.jsx's importFormAnugerahExcel. */}
            {order.remark && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="dim">Remark</div>
                <div>{order.remark}</div>
              </div>
            )}

            {awaitingApproval ? (
              <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
                <p className="hint-text" style={{ marginTop: 0 }}>
                  This order hasn't been approved in the system yet. Adjust pricing if needed, then Approve + save the Invoice Number below — this approves the order the same way a Salesman's own Approve would.
                </p>
                <PriceTable
                  rows={rows} editable priceDrafts={priceDrafts} setPrice={setPrice}
                  plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
                  hideCategory combineJenisPlak
                />

                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Approve &amp; Invoice Number</div>
                <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-2)' }}>
                  <label htmlFor="invoiceId">Invoice Number</label>
                  <input
                    className="input"
                    id="invoiceId"
                    placeholder="e.g. INV-2026-090"
                    value={invoiceDraft}
                    onChange={(e) => setInvoiceDraft(e.target.value)}
                  />
                </div>
                {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

                <div className="row-split" style={{ marginTop: 'var(--space-4)' }}>
                  <span />
                  <button type="button" className="btn btn-primary" onClick={handleApproveAndInvoice} disabled={!invoiceDraft.trim()}>
                    Approve &amp; Save Invoice
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice Number</div>
                {order.invoiceId ? (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <div>{order.invoiceId}</div>
                  </div>
                ) : (
                  <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-2)' }}>
                    <label htmlFor="invoiceId">Invoice Number</label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        className="input"
                        id="invoiceId"
                        placeholder="e.g. INV-2026-090"
                        value={invoiceDraft}
                        onChange={(e) => setInvoiceDraft(e.target.value)}
                      />
                      <button type="button" className="btn btn-primary" onClick={handleSaveInvoice}>Save</button>
                    </div>
                  </div>
                )}
                {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Original vs Tambahan</div>
                {itemGroups.map((group, gi) => {
                  const groupQty = group.items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
                  const groupHarga = group.items.reduce((sum, it) => sum + it.harga, 0);
                  return (
                    <div key={group.batch}>
                      <div className="card-kicker" style={{ marginTop: gi === 0 ? 'var(--space-2)' : 'var(--space-6)' }}>{group.label}</div>
                      <table className="table" style={{ margin: 'var(--space-3) 0 0' }}>
                        <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 110 }}>QTY</th><th style={{ width: 130 }}>Price per Unit</th><th style={{ width: 130 }}>Harga</th></tr></thead>
                        <tbody>
                          {group.items.map((it) => (
                            <tr key={it.id}>
                              <td>{it.categoryLabel}</td>
                              <td>{it.jenisPlak}</td>
                              <td>{it.qty}</td>
                              <td>{it.originalUnitPrice != null ? `RM ${it.originalUnitPrice.toFixed(2)} → ` : ''}RM {(it.unitPrice ?? 0).toFixed(2)}</td>
                              <td>RM {it.harga.toFixed(2)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td /><td /><td><strong>{groupQty}</strong></td><td><strong>SUBTOTAL</strong></td>
                            <td><strong>RM {groupHarga.toFixed(2)}</strong></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </>
            )}

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <span />
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
                  <OrderCategoryBlock key={blk.idx} blk={blk} editable={READONLY} />
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
