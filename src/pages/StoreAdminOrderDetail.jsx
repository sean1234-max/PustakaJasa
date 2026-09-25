import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav';
import CategoryTabs from '../components/CategoryTabs';
import OrderCategoryBlock from '../components/OrderCategoryBlock';
import PriceTable from '../components/PriceTable';
import DatePicker from '../components/DatePicker';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, standardUnitPrice } from '../data/catalog';
import { reconstructBlocksForCategory } from '../utils/computeBlocks';
import { splitOrderCategories, getInvoiceIdForJenisPlak } from '../utils/exportCsv';
import { combineByJenisPlak } from '../utils/orderBatches';
import { getOrderImportUrl } from '../lib/storageApi';
import { getOrderChangeStamp } from '../utils/orderStamp';
import { isUrgentShipment } from '../utils/urgentOrder';

// Downloads the teacher's original FORM ANUGERAH upload (0055) via a
// short-lived signed URL — for cross-checking the order against the file.
async function downloadOrderImport(order, setErr) {
  setErr('');
  const url = await getOrderImportUrl(order.importFilePath);
  if (!url) { setErr('Could not download the file right now. Please try again.'); return; }
  const a = document.createElement('a');
  a.href = url;
  a.download = order.importFileName || 'order.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const READONLY = { lines: false, rowDesc: false, rowQty: false, addRemoveRows: false, matrix: false, jenisPlak: false };

// Lets Store Admin split ONE order across several invoice numbers when
// different Jenis Plak codes bill separately (orders.invoice_groups, 0070)
// — tick the Jenis Plak codes that go on a different invoice, type that
// invoice's number, and assign. Repeatable: tick the next batch and assign
// a second invoice number afterward. Anything never touched here keeps
// billing under the order's own (default) Invoice Number.
//
// Split by Jenis Plak, not category — "PKC 263" is one physical
// Illustrator file no matter which category ordered it (the same code
// bought under two categories is already combined into ONE line above, in
// the Jenis Plak / Price per Unit / QTY / Harga table via combineByJenisPlak
// — see PriceTable's combineJenisPlak), so that's the natural unit here too,
// not the category breakdown Production's per-category export uses.
//
// Also usable BEFORE the order is even approved (order.invoiceId still
// null) — orders_write_guard (0070) excludes invoice_groups from its
// store_admin diff-check unconditionally, not just once In Production, so
// this write is allowed at either stage. That lets Store Admin plan the
// split the moment they SEE the order needs one, instead of being forced to
// pick one "default" invoice number at Approve time and only split
// afterwards. A Jenis Plak with no group yet falls back to display the
// order's own invoiceId once that's set (see `defaultLabel`).
//
// Collapsed to a single "Split Invoice" button by default — most orders
// never need this, so the checkbox list/second Invoice Number field would
// just be noise on every normal order. Clicking it reveals the rest; once
// expanded it stays expanded (no need to collapse back — there's nothing
// destructive to hide).
function InvoiceSplitPanel({ order, setJenisPlakInvoiceGroup, updateToast }) {
  const jenisPlakRows = useMemo(() => combineByJenisPlak(order.items), [order.items]);
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [busy, setBusy] = useState(false);

  if (jenisPlakRows.length < 2) return null;

  if (!expanded) {
    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setExpanded(true)}>
          Split Invoice
        </button>
      </div>
    );
  }

  const toggle = (key) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const handleAssign = async () => {
    if (busy || selected.size === 0 || !invoiceDraft.trim()) return;
    setBusy(true);
    const res = await setJenisPlakInvoiceGroup(order.id, invoiceDraft, [...selected]);
    setBusy(false);
    if (res?.ok) {
      setSelected(new Set());
      setInvoiceDraft('');
    }
  };

  const defaultLabel = order.invoiceId || 'whatever Invoice Number you approve this order with';

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div className="card-kicker">Split Across Invoices</div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        Tick the Jenis Plak that belong on a different invoice, type that invoice number, then assign. Jenis Plak left unticked stay on {defaultLabel}.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
        {jenisPlakRows.map((row) => {
          const current = getInvoiceIdForJenisPlak(order, row.jenisPlak);
          return (
            <label key={row.jenisPlak} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <input type="checkbox" checked={selected.has(row.jenisPlak)} onChange={() => toggle(row.jenisPlak)} />
              <span>{row.jenisPlak}</span>
              {/* getInvoiceIdForJenisPlak falls back to order.invoiceId, then
                  order.id — before approval, order.invoiceId is still null,
                  so an un-split Jenis Plak would otherwise show the ORDER ID
                  here and look like a real invoice number. Only show it once
                  it's a real group override or the order actually has one. */}
              {(order.invoiceId || (order.invoiceGroups || []).some((g) => (g.jenisPlakList || []).includes(row.jenisPlak))) && (
                <span className="dim">— currently {current}</span>
              )}
            </label>
          );
        })}
      </div>
      <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-3)' }}>
        <label htmlFor="invoiceSplitDraft">Invoice Number for Ticked Jenis Plak</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <input
            className="input"
            id="invoiceSplitDraft"
            placeholder="e.g. INV-0091"
            value={invoiceDraft}
            onChange={(e) => setInvoiceDraft(e.target.value)}
          />
          <button type="button" className="btn btn-primary" onClick={handleAssign} disabled={busy || selected.size === 0 || !invoiceDraft.trim()}>
            {busy ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
      {updateToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{updateToast}</p>}
    </div>
  );
}

// Pre-approval only: lets Store Admin decide the split BEFORE ever clicking
// Approve, instead of committing to one invoice number first and only
// splitting afterwards. Purely local draft state here — nothing is written
// to Supabase by this component. handleApproveAndInvoice bundles whatever's
// ticked here into the SAME approveAndSetInvoiceId call that sets the
// order's own (default) Invoice Number, so status + both invoice numbers +
// the split all land in ONE write, one order id, one Approve click — not a
// separate "Assign" round-trip per group like the post-approval
// InvoiceSplitPanel below (that one has no single "big action" left to
// piggyback on, since the main invoice is already committed by then).
// Collapsed to a single "Split Invoice" button by default, same reasoning
// as InvoiceSplitPanel — most orders never need this.
function InvoiceSplitDraft({ order, splitInvoiceId, setSplitInvoiceId, splitSelected, setSplitSelected }) {
  const jenisPlakRows = useMemo(() => combineByJenisPlak(order.items), [order.items]);
  const [expanded, setExpanded] = useState(false);

  if (jenisPlakRows.length < 2) return null;

  if (!expanded) {
    return (
      <div style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-secondary" onClick={() => setExpanded(true)}>
          Split Invoice
        </button>
      </div>
    );
  }

  const toggle = (key) => setSplitSelected((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      <div className="card-kicker">Split Across Invoices</div>
      <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-2)' }}>
        <label htmlFor="splitInvoiceId">New Invoice Number</label>
        <input
          className="input"
          id="splitInvoiceId"
          placeholder="e.g. INV-0091"
          value={splitInvoiceId}
          onChange={(e) => setSplitInvoiceId(e.target.value)}
        />
      </div>
      <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>
        Tick the Jenis Plak that go on this new invoice. Everything else stays on the Invoice Number above once you Approve.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
        {jenisPlakRows.map((row) => (
          <label key={row.jenisPlak} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <input type="checkbox" checked={splitSelected.has(row.jenisPlak)} onChange={() => toggle(row.jenisPlak)} />
            <span>{row.jenisPlak}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// Store Admin's own order view (role formerly "Invoicing Department",
// renamed 0047) — assigns/displays the Invoice Number and shows the
// original-vs-Tambahan breakdown via PriceTable's own batch-grouping, same
// component SalesOrderSummary/OrderDetails already use.
//
// A Salesman sometimes hands Store Admin a paper hard copy of an order
// before ever clicking Approve in the system — receiving that hard copy
// already means they've agreed to it. So while an order is still
// "Submitted to Sales", this page lets Store Admin adjust pricing and the
// Shipment / Function dates (same capability Sales would have had) and
// Approve + save the Invoice Number in one action (approveAndSetInvoiceId,
// src/state/AppState.jsx) — no separate Sales click needed, the order goes
// straight into Production. Once an order is already "In Production"
// (approved via either path), pricing and dates are frozen and this page
// falls back to the simple invoice-only entry (setInvoiceId), same as before.
export default function StoreAdminOrderDetail() {
  const {
    state, today, setInvoiceId, approveAndSetInvoiceId, setJenisPlakInvoiceGroup, retryUrgentSheetSync, ensureOrderLoaded,
  } = useAppState();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const order = state.orders.find((o) => o.id === id);
  const awaitingApproval = order?.status === 'Submitted to Sales';
  useEffect(() => { ensureOrderLoaded(id); }, [id, ensureOrderLoaded]);

  // Opened from one specific invoice's card on the dashboard (a split order
  // shows one card per invoice, see StoreAdminDashboard.jsx/
  // getOrderInvoiceSlices) — ?invoice= says which one, so the Summary
  // page's Jenis Plak table/Total/Invoice Number below only show that
  // invoice's own slice instead of the whole order every time, regardless
  // of which card was actually clicked. Absent (or an un-split order, which
  // has no invoiceGroups to slice by) just shows everything, same as
  // before this existed. The "Order Details" tab (page 2) and the
  // Download-Excel-Backup button are deliberately NOT filtered — a
  // category's reference-sample layout and the teacher's original upload
  // are both whole-order concepts Production needs in full regardless of
  // how the bill happens to be split.
  const viewInvoiceId = searchParams.get('invoice') || null;
  const isFiltered = !!viewInvoiceId && !!(order?.invoiceGroups || []).length;

  const [invoiceDraft, setInvoiceDraft] = useState('');
  const [page, setPage] = useState('summary');
  const [busy, setBusy] = useState(false);
  const [importErr, setImportErr] = useState('');

  // Pre-approval invoice-split draft — see InvoiceSplitDraft above. Lives
  // here (not inside that component) so handleApproveAndInvoice can read it
  // when building the single approveAndSetInvoiceId call.
  const [splitInvoiceId, setSplitInvoiceId] = useState('');
  const [splitSelected, setSplitSelected] = useState(() => new Set());

  // Shipment Date (shipmentDate) / Function Date — editable only while the
  // order is still awaiting approval, the same window Sales has (guard 0038
  // lets Store Admin change shipment_date/function_date only before 'In
  // Production'). A Salesman who's out of office can hand Store Admin the
  // paper hard copy to key the Shipment Date + Invoice Number here,
  // force-approving it straight into Production.
  const [shipmentDateDraft, setShipmentDateDraft] = useState(() => (order?.shipmentDate ? new Date(order.shipmentDate) : null));
  const [functionDateDraft, setFunctionDateDraft] = useState(() => (order?.functionDate ? new Date(order.functionDate) : null));
  const [dateError, setDateError] = useState('');

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
  // Only this specific invoice's items when opened via ?invoice= (see
  // isFiltered above) — everything otherwise, same as before this existed.
  const visibleItems = useMemo(() => {
    const items = order?.items || [];
    if (!isFiltered) return items;
    return items.filter((it) => getInvoiceIdForJenisPlak(order, it.jenisPlak) === viewInvoiceId);
  }, [order, isFiltered, viewInvoiceId]);
  const rows = useMemo(() => visibleItems.map((it) => {
    const unitPrice = Number(priceDrafts[it.id] ?? it.unitPrice ?? 0);
    const harga = unitPrice * (Number(it.qty) || 0);
    return { ...it, unitPrice, harga };
  }), [visibleItems, priceDrafts]);
  const setPrice = (itemIds, value) => setPriceDrafts((prev) => {
    const next = { ...prev };
    itemIds.forEach((itemId) => { next[itemId] = value; });
    return next;
  });

  const { anugerah: categories, selempang: selempangCats } = useMemo(
    () => (order ? splitOrderCategories(order) : { anugerah: [], selempang: [] }),
    [order],
  );
  const [activeCat, setActiveCat] = useState(() => categories[0]?.key || '');
  const currentCat = categories.find((c) => c.key === activeCat) || categories[0];
  const catBlocks = useMemo(() => {
    if (!order || !currentCat) return [];
    return reconstructBlocksForCategory(order, currentCat.key, state.plakCatalog).blocks;
  }, [order, currentCat, state.plakCatalog]);
  const selempangBlocks = useMemo(() => {
    if (!order) return [];
    return selempangCats.flatMap((cat) => reconstructBlocksForCategory(order, cat.key, state.plakCatalog).blocks);
  }, [order, selempangCats, state.plakCatalog]);
  if (!order) return null;

  const stamp = getOrderChangeStamp(order);
  const totalQty = rows.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
  const totalHarga = rows.reduce((sum, it) => sum + it.harga, 0);
  const priceAdjusted = order.priceAdjusted || rows.some((it) => it.unitPrice !== standardUnitPrice(it.jenisPlak, state.plakCatalog));

  const handleSaveInvoice = async () => {
    if (busy) return;
    setBusy(true);
    const res = await setInvoiceId(order.id, invoiceDraft);
    setBusy(false);
    if (res?.ok) setInvoiceDraft('');
  };

  const handleApproveAndInvoice = async () => {
    if (busy) return;
    if (shipmentDateDraft && functionDateDraft
      && new Date(shipmentDateDraft.getFullYear(), shipmentDateDraft.getMonth(), shipmentDateDraft.getDate())
       > new Date(functionDateDraft.getFullYear(), functionDateDraft.getMonth(), functionDateDraft.getDate())) {
      setDateError('Shipment Date can’t be after the Function Date. Adjust one of them before approving.');
      return;
    }
    setDateError('');
    const updatedItems = rows.map((r) => ({ ...r, unitPrice: r.unitPrice, harga: r.harga }));
    // Only sends a date when Store Admin actually has one — never blanks an
    // existing shipment/function date because the draft started empty.
    const overrides = {};
    if (shipmentDateDraft) overrides.shipmentDate = shipmentDateDraft;
    if (functionDateDraft) overrides.functionDate = functionDateDraft;
    // Bundles whatever's ticked in InvoiceSplitDraft into this SAME write —
    // empty if Store Admin never opened/used that panel, same as before.
    const invoiceGroups = splitSelected.size > 0 && splitInvoiceId.trim()
      ? [{ invoiceId: splitInvoiceId, jenisPlakList: [...splitSelected] }]
      : [];
    setBusy(true);
    const res = await approveAndSetInvoiceId(order.id, updatedItems, invoiceDraft, overrides, invoiceGroups);
    setBusy(false);
    if (res?.ok) {
      setInvoiceDraft('');
      setSplitInvoiceId('');
      setSplitSelected(new Set());
    }
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/store-admin/dashboard')}>
        ← Back to Store Admin
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
            {/* Production uploaded a corrected copy of the teacher's file
                (see ProductionOrderDetail's CorrectedExcelControl). */}
            {order.correctedImportFilePath && (
              <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>Excel Updated</span>
            )}
            <span className="status-pill" style={statusPillStyle(order.status)}>{order.status}</span>
          </div>
        </div>

        {isFiltered && (
          <p className="hint-text" style={{ marginBottom: 'var(--space-3)' }}>
            Showing only the <strong>{viewInvoiceId}</strong> invoice for this order — the Jenis Plak/Total below cover just that slice.{' '}
            <button type="button" onClick={() => navigate(`/store-admin/orders/${order.id}`)} className="text-label-bold font-semibold text-primary hover:underline">
              View full order
            </button>
          </p>
        )}

        {page === 'summary' ? (
          <>
            <div className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              {order.sekolah && <div><div className="dim">Sekolah</div><div>{order.sekolah}</div></div>}
              {order.sales && <div><div className="dim">Salesman</div><div>{order.sales}</div></div>}
              {order.picName && <div><div className="dim">PIC Name</div><div>{order.picName}{order.phone ? ` / ${order.phone}` : ''}</div></div>}
              {order.terms && <div><div className="dim">Terms</div><div>{order.terms}</div></div>}
              {awaitingApproval ? (
                <>
                  {/* Shipment Date can't be before today (already-past dates
                      aren't a real shipment option) or after the Function
                      Date (the event itself) — picker caps at both and
                      Approve re-checks. */}
                  <DatePicker label="Shipment Date" id="storeAdminShipmentDate" selected={shipmentDateDraft} today={today} onSelect={setShipmentDateDraft} minDate={today} maxDate={functionDateDraft} />
                  <DatePicker label="Function Date" id="storeAdminFunctionDate" selected={functionDateDraft} today={today} onSelect={setFunctionDateDraft} minDate={shipmentDateDraft || today} />
                  {dateError && <div className="login-error" style={{ gridColumn: '1 / -1', margin: 0 }}>{dateError}</div>}
                  {/* Same non-blocking heads-up as SalesOrderSummary.jsx — see
                      urgentOrder.js. No override control. */}
                  {shipmentDateDraft && isUrgentShipment(today, shipmentDateDraft) && (
                    <p className="urgent-hint" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      ⚡ This Shipment Date is less than 5 working days away — the order will be marked Urgent once approved.
                    </p>
                  )}
                </>
              ) : (
                <>
                  {order.shipmentDate && <div><div className="dim">Shipment Date</div><div>{formatDate(new Date(order.shipmentDate))}</div></div>}
                  {order.functionDate && <div><div className="dim">Function Date</div><div>{formatDate(new Date(order.functionDate))}</div></div>}
                </>
              )}
              <div><div className="dim">Order Date</div><div>{order.datePlaced}</div></div>
              <div><div className="dim">Total Amount</div><div>RM {(isFiltered ? totalHarga : order.totalAmount).toFixed(2)}</div></div>
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

            {order.importFilePath && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <div className="dim">Download Excel File (Backup)</div>
                <button type="button" className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => downloadOrderImport(order, setImportErr)}>
                  ⬇ {order.importFileName || 'Download file'}
                </button>
                {importErr && <div className="login-error" style={{ marginTop: 4 }}>{importErr}</div>}
              </div>
            )}

            {awaitingApproval ? (
              <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Jenis Plak / Price per Unit / QTY / Harga</div>
                <p className="hint-text" style={{ marginTop: 0 }}>
                  This order hasn't been approved in the system yet. Set the Shipment Date above, adjust pricing if needed, then Approve + save the Invoice Number below — this approves the order the same way a Salesman's own Approve would and sends it straight to Production.
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
                    placeholder="e.g. INV-0090"
                    value={invoiceDraft}
                    onChange={(e) => setInvoiceDraft(e.target.value)}
                  />
                </div>
                {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

                <InvoiceSplitDraft
                  order={order}
                  splitInvoiceId={splitInvoiceId}
                  setSplitInvoiceId={setSplitInvoiceId}
                  splitSelected={splitSelected}
                  setSplitSelected={setSplitSelected}
                />

                <div className="row-split" style={{ marginTop: 'var(--space-4)' }}>
                  <span />
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleApproveAndInvoice}
                    disabled={busy || !invoiceDraft.trim() || !shipmentDateDraft || (splitSelected.size > 0 && !splitInvoiceId.trim())}
                  >
                    {busy ? 'Working…' : 'Approve & Save Invoice'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Invoice Number</div>
                {order.invoiceId ? (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <div>{isFiltered ? viewInvoiceId : order.invoiceId}</div>
                    {/* Gated on the PERSISTED urgentSheetSyncedAt flag (not
                        just this session's sheetSyncErrors), so it reappears
                        correctly after a page refresh too — see
                        attemptUrgentSheetSync/retryUrgentSheetSync in
                        AppState.jsx. */}
                    {order.urgent && !order.urgentSheetSyncedAt && (
                      <p className="text-error" style={{ marginTop: 'var(--space-2)' }}>
                        {state.sheetSyncErrors[order.id] || 'Urgent-order sheet sync pending.'}{' '}
                        <button type="button" onClick={() => retryUrgentSheetSync(order.id)} className="text-label-bold font-semibold text-primary hover:underline">Retry</button>
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="field" style={{ maxWidth: 340, marginTop: 'var(--space-2)' }}>
                    <label htmlFor="invoiceId">Invoice Number</label>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      <input
                        className="input"
                        id="invoiceId"
                        placeholder="e.g. INV-0090"
                        value={invoiceDraft}
                        onChange={(e) => setInvoiceDraft(e.target.value)}
                      />
                      <button type="button" className="btn btn-primary" onClick={handleSaveInvoice} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
                    </div>
                  </div>
                )}
                {state.productionToast && <p className="hint-text" style={{ marginTop: 'var(--space-2)' }}>{state.productionToast}</p>}

                <InvoiceSplitPanel order={order} setJenisPlakInvoiceGroup={setJenisPlakInvoiceGroup} updateToast={state.updateToast} />

                <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Original vs Tambahan</div>
                <p className="hint-text" style={{ marginTop: 0 }}>
                  Combined by Jenis Plak, not Category — the same code bought for two different categories is one line here with one combined QTY.
                </p>
                <PriceTable
                  rows={rows} editable={false} priceDrafts={priceDrafts} setPrice={setPrice}
                  plakCatalog={state.plakCatalog} totalQty={totalQty} totalHarga={totalHarga} priceAdjusted={priceAdjusted}
                  hideCategory combineJenisPlak
                />
              </>
            )}

            <div className="row-split" style={{ marginTop: 'var(--space-6)' }}>
              <span />
              <button type="button" className="btn btn-primary" onClick={() => setPage('details')}>Next: Order Details →</button>
            </div>
          </>
        ) : (
          <>
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
    </div>
  );
}
