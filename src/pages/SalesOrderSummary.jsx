import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import PriceTable from '../components/PriceTable';
import OrderPrintout from '../components/OrderPrintout';
import DatePicker from '../components/DatePicker';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, standardUnitPrice, formatDate, defaultShipmentDate, toMalaysiaDay, malaysiaToday, isReviewed, isAddonInFlight } from '../data/catalog';
import CancelOrderControl from '../components/CancelOrderControl';
import ReassignSalesmanControl from '../components/ReassignSalesmanControl';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { splitOrderCategories } from '../utils/exportCsv';
import { getOrderChangeStamp } from '../utils/orderStamp';
import { isUrgentShipment } from '../utils/urgentOrder';

// Read-only everywhere — this page only ever displays what the teacher
// already submitted, it never edits the underlying order/category data.
const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

export default function SalesOrderSummary() {
  const { state, today, approveOrder, approveAddOn, rejectAddOn, recordPrint, ensureOrderLoaded, loadCorrectedExcelPreview, openAmend, openAddOn } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const order = state.orders.find((o) => o.id === id);
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Production may have uploaded a corrected FORM ANUGERAH file for this
  // order (ProductionOrderDetail.jsx's CorrectedExcelControl) — re-parsed
  // here too so the Order Details tab (and its print output) show the same
  // corrected reference-sample text/qty Production is now working from,
  // not the teacher's original. Pricing (rows/PriceTable below) is
  // deliberately left on the REAL `order` — this never touches
  // total_amount/stock, same boundary as the Production side.
  const [correctedItems, setCorrectedItems] = useState(null);
  const [correctedError, setCorrectedError] = useState('');
  useEffect(() => {
    setCorrectedItems(null);
    setCorrectedError('');
    if (!order?.correctedImportFilePath) return;
    let cancelled = false;
    loadCorrectedExcelPreview(order).then((res) => {
      if (cancelled) return;
      if (res.ok) setCorrectedItems(res.items);
      else setCorrectedError(res.message || 'Could not re-read the corrected file.');
    });
    return () => { cancelled = true; };
    // See ProductionOrderDetail.jsx's identical effect for why this is
    // scoped to id/correctedImportFilePath rather than the whole `order`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, order?.correctedImportFilePath, loadCorrectedExcelPreview]);
  const effectiveOrder = useMemo(
    () => (correctedItems ? { ...order, items: correctedItems } : order),
    [order, correctedItems],
  );
  // A Sales Manager can open any salesman's order (RLS —
  // supabase/migrations/0048_sales_manager.sql) but only acts on their own;
  // for someone else's order every write control is hidden (the server would
  // reject the write anyway via "salesman updates own orders").
  const isOwn = !state.isSalesManager || !order || order.salesmanId === state.userAuthId;
  // Approve (Shipment Date, prices) only after Production's Done Review
  // (0077); before that the order is shown read-only, waiting.
  const reviewing = order?.status === 'Reviewing Order';
  const awaitingReview = reviewing && !isReviewed(order);
  const addonReviewed = order?.pendingAddonStatus === 'reviewed';
  const canAmend = reviewing;
  const canAddOn = ['Salesman Approved', 'In Production'].includes(order?.status) && !isAddonInFlight(order);
  const editable = reviewing && isReviewed(order) && isOwn;

  // Shipment Date (shipmentDate) / Function Date stay editable right up to the moment of
  // approval — the same "Sales can still adjust it" window the price
  // fields already had — then get folded into the approval update below.
  const [shipmentDateDraft, setShipmentDateDraft] = useState(() => (order?.shipmentDate ? toMalaysiaDay(order.shipmentDate) : null));
  // "Salesman hantar sendiri" — the salesman delivers this order himself;
  // saved on Approve, printed on the order for Store Admin (0079).
  const [salesmanDeliveryDraft, setSalesmanDeliveryDraft] = useState(() => !!order?.salesmanDelivery);
  const [functionDateDraft, setFunctionDateDraft] = useState(() => (order?.functionDate ? toMalaysiaDay(order.functionDate) : null));
  const [dateError, setDateError] = useState('');
  // An order with no Shipment Date yet starts at a week after it was placed
  // (defaultShipmentDate) — saved on Approve like a date Sales picked.
  const shipmentDate = shipmentDateDraft
    || (order && editable ? defaultShipmentDate(order.datePlaced, malaysiaToday(), functionDateDraft) : null);

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
  const [busy, setBusy] = useState(false);

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

  const { anugerah: categories, selempang: selempangCats } = useMemo(
    () => (effectiveOrder ? splitOrderCategories(effectiveOrder) : { anugerah: [], selempang: [] }),
    [effectiveOrder],
  );
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!effectiveOrder || !currentCat) return [];
    return reconstructBlocksForCategory(effectiveOrder, currentCat.key, state.plakCatalog).blocks;
  }, [effectiveOrder, currentCat, state.plakCatalog]);
  const selempangBlocks = useMemo(() => {
    if (!effectiveOrder) return [];
    return selempangCats.flatMap((cat) => reconstructBlocksForCategory(effectiveOrder, cat.key, state.plakCatalog).blocks);
  }, [effectiveOrder, selempangCats, state.plakCatalog]);

  // Printing needs every category's details at once, not just whichever
  // tab happens to be open on screen — the tab UI is for browsing, the
  // printout is the full order. Kept grouped per category (rather than
  // flattened) so the print layout can force a page break between
  // categories without losing track of which blocks belong together.
  const catBlockGroups = useMemo(() => {
    if (!effectiveOrder) return [];
    return [...categories, ...selempangCats].map((cat) => ({
      cat,
      blocks: reconstructBlocksForCategory(effectiveOrder, cat.key, state.plakCatalog).blocks,
    }));
  }, [effectiveOrder, categories, selempangCats, state.plakCatalog]);

  if (!order) return null;

  // Only shown once Sales has approved (matches the same `editable` gate
  // the Print button itself uses) — see getOrderChangeStamp.
  const stamp = !editable ? getOrderChangeStamp(order) : null;
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  const addOnTotalQty = addOnRows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const addOnTotalHarga = addOnRows.reduce((sum, it) => sum + it.harga, 0);

  // `setPrice` is called with an array of item ids by PriceTable (every id
  // a combined Jenis Plak row stands in for) so editing a combined row's
  // price applies to every underlying item at once.
  const setPrice = (itemIds, value) => setPriceDrafts((prev) => {
    const next = { ...prev };
    itemIds.forEach((itemId) => { next[itemId] = value; });
    return next;
  });
  const setAddOnPrice = (itemId, value) => setAddOnPriceDrafts((prev) => ({ ...prev, [itemId]: value }));

  // Stays on this page after approving (instead of bouncing back to the
  // dashboard) so Sales can immediately print the now-approved order —
  // the page re-renders read-only once order.status flips, and the Print
  // button takes its place where Approve was.
  const handleApprove = async () => {
    if (busy) return;
    if (shipmentDate && functionDateDraft
      && new Date(shipmentDate.getFullYear(), shipmentDate.getMonth(), shipmentDate.getDate())
       > new Date(functionDateDraft.getFullYear(), functionDateDraft.getMonth(), functionDateDraft.getDate())) {
      setDateError('Shipment Date can’t be after the Function Date. Adjust one of them before approving.');
      return;
    }
    setDateError('');
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    // Only overrides a date if Sales actually set one — never blanks an
    // existing shipment/function date just because the draft state happened
    // to start empty (e.g. a legacy order that predates these fields).
    const overrides = {};
    if (shipmentDate) overrides.shipmentDate = shipmentDate;
    if (functionDateDraft) overrides.functionDate = functionDateDraft;
    overrides.salesmanDelivery = salesmanDeliveryDraft;
    setBusy(true);
    await approveOrder(order.id, updatedItems, overrides);
    setBusy(false);
    // On success order.status flips locally and this page re-renders
    // read-only; on failure the error toast (state.updateToast) shows.
  };

  const handleApproveAddOn = async () => {
    if (busy) return;
    setBusy(true);
    await approveAddOn(order.id, addOnRows.map((r) => ({ ...r })));
    setBusy(false);
  };

  const handleRejectAddOn = async () => {
    if (busy) return;
    setBusy(true);
    const res = await rejectAddOn(order.id, rejectReason.trim());
    setBusy(false);
    if (res?.ok) setRejectReason('');
  };

  // Deferred a tick so the just-updated printedAt (recordPrint) has
  // actually re-rendered into the print-only DOM before window.print()
  // reads it — see the identical note in OrderDetails.jsx.
  const handlePrint = () => { recordPrint(order.id); setTimeout(() => window.print(), 0); };

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {stamp && <span className="order-stamp-inline no-print">{stamp}</span>}
            {/* Production uploaded a corrected copy of the teacher's file —
                Order Details below (and the printout) already read from it;
                pricing above stays on the originally invoiced items. */}
            {order.correctedImportFilePath && (
              <span className="status-pill no-print" style={{ background: '#fff4ce', color: '#8a6d00' }}>Excel Updated</span>
            )}
            <span className="status-pill" style={statusPillStyle(order.status)}>{order.status}</span>
          </div>
        </div>

        <div className="screen-only">
          {awaitingReview && (
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)', fontWeight: 600, color: '#8a6d00' }}>
              Production is still reviewing this order — you can set the Shipment Date and approve it once they click Done Review.
            </p>
          )}
          {reviewing && !awaitingReview && (
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)', fontWeight: 600, color: '#2f6b4f' }}>
              ✓ Production has reviewed this order — ready to approve.
            </p>
          )}
          {!isOwn && (
            <p className="hint-text" style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
              Viewing {order.sales || 'another salesman'}’s order — read-only. Only {order.sales || 'the assigned salesman'} can approve or edit it.
            </p>
          )}
          {page === 'summary' ? (
            <>
              <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
                {/* Every other order-viewing screen (teacher, Store Admin,
                    Production) already shows this on screen — it used to be
                    printed-only here. */}
                <div><div className="dim">Invoice Number</div><div>{order.invoiceId || '—'}</div></div>
                {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
                {order.sales && <div><div className="dim">Sales</div><div>{order.sales}</div></div>}
                {order.createdBySalesman && <div><div className="dim">Placed by</div><div>Salesman {order.snapshot?.placedBy || ''}</div></div>}
                {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
                {order.ketuaPanitia && <div><div className="dim">Ketua Panitia</div><div>{order.ketuaPanitia}</div></div>}
                {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
                {editable ? (
                  <>
                    {/* "Shipment Date" (stored as shipmentDate) is when the plaques
                        ship out — it can't be before today (already-past
                        dates aren't a real shipment option) or after the
                        Function Date (the event itself), so the picker caps
                        at both and Approve re-checks. */}
                    <DatePicker label="Shipment Date" id="salesShipmentDate" selected={shipmentDate} today={today} onSelect={setShipmentDateDraft} minDate={today} maxDate={functionDateDraft} />
                    <DatePicker label="Function Date" id="salesFunctionDate" selected={functionDateDraft} today={today} onSelect={setFunctionDateDraft} minDate={shipmentDate || today} />
                    <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                      <input type="checkbox" checked={salesmanDeliveryDraft} onChange={(e) => setSalesmanDeliveryDraft(e.target.checked)} />
                      I will deliver this order myself (Salesman hantar sendiri)
                    </label>
                    {dateError && <div className="login-error" style={{ gridColumn: '1 / -1', margin: 0 }}>{dateError}</div>}
                    {/* Informational only — never blocks Approve, no way to
                        override the urgent determination itself. Purely a
                        heads-up before the "urgent" flag gets snapshotted
                        on Approve (see urgentOrder.js). */}
                    {shipmentDate && isUrgentShipment(malaysiaToday(), shipmentDate) && (
                      <p className="urgent-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                        ⚡ This Shipment Date is within 7 days of approving today — the order will be marked Urgent once approved.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(toMalaysiaDay(order.shipmentDate))}</div></div>}
                    {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(toMalaysiaDay(order.functionDate))}</div></div>}
                    {order.salesmanDelivery && <div><div className="dim">Delivery</div><div><strong>Salesman hantar sendiri</strong></div></div>}
                  </>
                )}
              </div>
              {/* Not shown here before this — an import-derived note (a KIV
                  line, a wording-only plaque parked here for now) landed in
                  this SAME field but had nowhere to actually surface for
                  Sales, so it went unseen until the teacher happened to
                  mention it separately. See AppState.jsx's importFormAnugerahExcel. */}
              {order.remark && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="dim">Remark</div>
                  <div>{order.remark}</div>
                </div>
              )}

              <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
              <PriceTable
                rows={rows} editable={editable} priceDrafts={priceDrafts} setPrice={setPrice}
                plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
                hideCategory combineJenisPlak
              />
              {/* SELEMPANG's rows (ACARA / WARNA / QTY) also show right here on the
                  Summary — the only category that does (Sean); every category's full
                  details stay on the Order Details tab. */}
              {selempangBlocks.map((blk) => (
                <div key={`sum-sel-${blk.idx}`} style={{ marginTop: 'var(--space-6)' }}>
                  <OrderCategoryBlock blk={blk} editable={READONLY} />
                </div>
              ))}

              {isAddonInFlight(order) && isOwn && (
                <>
                  <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>
                    Tambahan — {addonReviewed ? 'Pending Approval' : 'Waiting for Production review'}
                  </div>
                  <p className="hint-text" style={{ marginTop: 0 }}>
                    {addonReviewed
                      ? 'Production has reviewed it. Adjust pricing if needed, then approve to add these into the order, or reject to send it back.'
                      : 'Production reviews every add-on first — you can approve it once they have.'}
                  </p>
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
                    <button type="button" className="btn btn-ghost" onClick={handleRejectAddOn} disabled={busy}>Reject</button>
                    <button type="button" className="btn btn-primary" onClick={handleApproveAddOn} disabled={busy || !addonReviewed}>
                      {busy ? 'Working…' : addonReviewed ? 'Approve Add-On' : 'Waiting for Production review'}
                    </button>
                  </div>
                </>
              )}
              {order.pendingAddonStatus === 'rejected' && (
                <div className="login-error" style={{ marginTop: 'var(--space-6)' }}>
                  You rejected this add-on{order.pendingAddonRejectReason ? `: ${order.pendingAddonRejectReason}` : '.'} Waiting for the teacher to cancel or resubmit it.
                </div>
              )}

              {reviewing && isOwn && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <div className="card-kicker">Cancel</div>
                  <CancelOrderControl order={order} onCancelled={() => navigate('/sales/dashboard')} />
                </div>
              )}

              {/* Any status but Cancelled — a teacher can pick the wrong
                  salesman regardless of how far the order has since moved,
                  so this isn't limited to the pre-approval `editable` window
                  the way Cancel is. */}
              {isOwn && order.status !== 'Cancelled' && (
                <div style={{ marginTop: 'var(--space-6)' }}>
                  <div className="card-kicker">Wrong Salesman?</div>
                  <ReassignSalesmanControl order={order} onReassigned={() => navigate('/sales/dashboard')} />
                </div>
              )}

              {state.updateToast && <p className="toast-inline" style={{ display: 'block', marginTop: 'var(--space-4)' }}>{state.updateToast}</p>}
              <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPage('details')}>View Order Details →</button>
                {editable && <button type="button" className="btn btn-primary" onClick={handleApprove} disabled={busy}>{busy ? 'Approving…' : 'Approve'}</button>}
                {awaitingReview && <button type="button" className="btn btn-primary" disabled>Waiting for Production review</button>}
                {!reviewing && <button type="button" className="btn btn-primary" onClick={handlePrint}>Print Order</button>}
              </div>
              {/* Update Details until approval (a reviewed order goes back to
                  Production), Add On after it — same as the teacher (0085). */}
              {isOwn && (canAmend || canAddOn) && (
                <div className="row-split" style={{ marginTop: 'var(--space-3)', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                  {canAmend && <button type="button" className="btn btn-secondary" onClick={() => { openAmend(order); navigate(`/amend/${order.id}`); }}>Update Details</button>}
                  {canAddOn && <button type="button" className="btn btn-secondary" onClick={() => { openAddOn(order); navigate(`/addon/${order.id}`); }}>Add On</button>}
                </div>
              )}
            </>
          ) : (
            <>
              {order.correctedImportFilePath && (
                <p className="hint-text no-print" style={{ margin: '0 0 var(--space-3)', fontWeight: 600 }}>
                  {correctedError ? `⚠ ${correctedError} — showing the original data instead.` : 'Production uploaded a corrected Excel — showing that version below, not the teacher\'s original.'}
                </p>
              )}
              {categories.length === 0 && selempangBlocks.length === 0 ? (
                <p className="hint-text" style={{ marginTop: 'var(--space-3)' }}>No category details found for this order.</p>
              ) : (
                <>
                  {categories.length > 0 && (
                    <>
                      <div className="card-kicker" style={{ marginBottom: 'var(--space-2)' }}>Anugerah</div>
                      <div style={{ margin: 'var(--space-1) 0 var(--space-3)' }}>
                        <CategoryTabs categories={categories} active={currentCat?.key} onSelect={setActiveCat} />
                      </div>
                      {catBlocks.map((blk) => (
                        <OrderCategoryBlock key={blk.idx} blk={blk} editable={READONLY} />
                      ))}
                    </>
                  )}
                  {selempangBlocks.length > 0 && (
                    <div style={{ marginTop: categories.length > 0 ? 'var(--space-8)' : 0 }}>
                      {selempangBlocks.map((blk) => (
                        <OrderCategoryBlock key={`sel-${blk.idx}`} blk={blk} editable={READONLY} />
                      ))}
                    </div>
                  )}
                </>
              )}

              <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setPage('summary')}>← Back to Summary</button>
                <span />
              </div>
            </>
          )}
        </div>

        {/* Print-only — see the "Print Order" button, only shown once approved. */}
        <OrderPrintout
          order={order} invoiceId={order.invoiceId} printedAt={order.printedAt}
          urgent={order.urgent} stamp={stamp} showSales showRemark
          priceTable={{
            rows, priceDrafts, setPrice, plakCatalog: state.plakCatalog, totalQty, totalHarga, priceAdjusted,
            hideCategory: true, combineJenisPlak: true,
          }}
          catBlockGroups={catBlockGroups}
        />
      </div>
    </div>
  );
}
