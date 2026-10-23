import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import ConfirmButton from '../components/ConfirmButton';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, getLowStockAlerts, toMalaysiaDay, isAddonInFlight, invoiceLabel, invoiceSource, invoiceDate } from '../data/catalog';
import { getOrderChangeStamp } from '../utils/orderStamp';
import { getOrderInvoiceSlices } from '../utils/orderBatches';
import { countReservedPlaques, needsKiv, kivParts, hasMainPart, kivInProduction, kivInTyping } from '../utils/exportCsv';
import { prioritizeUrgentOrders, byInvoiceDate, keepTambahanWithParent } from '../utils/urgentOrder';
import OrderUrgentBadge from '../components/OrderUrgentBadge';
import AddOnTag from '../components/AddOnTag';
import { MANUAL_ARTWORK_NOTE } from '../components/CrystalPreview';
import { matchesOrderSearch } from '../utils/orderSearch';
import { duplicateSummary } from '../utils/duplicateOrders';
import ProductionInvoiceEntry from '../components/ProductionInvoiceEntry';

// Production works 'In Production' orders (invoice number or not — that's
// Store Admin's job now, see supabase/migrations/0036_add_invoicing_role.sql
// and StoreAdminDashboard.jsx); Done makes an order Completed (Sean,
// 2026-10-14 — no more Waiting for Shipment / Shipped / Order History).

// 'reviewing' is Production's own job first (0077): open the order, fix it
// (Edit Order) and click Done Review — Sales can only approve after that.
// 'approved' waits for Store Admin's Invoice Number; Production can already
// export its CSVs to get the AI file ready. Once invoiced the order is In
// Production, which only Production sees split in two (0078): 'typing' —
// generate the AI file, click Done Typing — then 'active', where the
// Production head prints it and clicks Done. Every other role just sees
// In Production.
// Every card is either an order's main card (`_part: 'main'`) or, for an order
// with Reserved plaques / crystals, its separate KIV & ARTWORK card (`_part:
// 'kiv'`, Sean 2026-10-14): plaques go Typing → In Production, that part goes
// KIV & ARTWORK → In Production — so one order can have two cards in In
// Production, one marked SHORT SUPPLY / CRYSTAL.
const main = (o) => o._part === 'main';
// One card of an order done while its other card is still being made (Sean, 2026-10-17): the
// plaques Done (plakDoneAt) or the KIV card Done (kivProductionDoneAt) — that card is Completed.
const partDone = (o) => o.status === 'In Production' && (main(o) ? !!o._primarySlice && !!o.plakDoneAt : !!o.kivProductionDoneAt);
const TABS = [
  { key: 'reviewing', label: 'Reviewing Order', match: (o) => main(o) && o.status === 'Reviewing Order' },
  // A submitted add-on (0085) — one card per order (its first invoice slice),
  // whatever the order's own status. Like Reviewing Order, it stays here
  // after Done Review until the salesman approves it.
  { key: 'addon', label: 'Add-On Review', match: (o) => main(o) && o._primarySlice && isAddonInFlight(o) },
  { key: 'approved', label: 'Salesman Approved', match: (o) => main(o) && o.status === 'Salesman Approved' },
  // Confirmed crystals ride on the plaques' card (hasMainPart); a crystal card of
  // its own waits here once confirmed (kivInTyping) — Sean, 2026-10-15.
  {
    key: 'typing',
    label: 'Typing',
    match: (o) => o.status === 'In Production' && (main(o) ? hasMainPart(o) && !o.typedAt : kivInTyping(o)),
  },
  { key: 'kiv', label: 'KIV & ARTWORK', match: (o) => o._part === 'kiv' && o.status === 'In Production' && needsKiv(o) && !kivInTyping(o) },
  {
    key: 'active',
    label: 'In Production',
    match: (o) => o.status === 'In Production' && (main(o)
      ? hasMainPart(o) && !!o.typedAt && !(o._primarySlice && o.plakDoneAt)
      : kivInProduction(o)),
  },
  // an order with a KIV card (crystals / Reserved) shows both its cards here too (Sean, 2026-10-17)
  { key: 'completed', label: 'Completed', match: (o) => partDone(o) || (o.status === 'Completed' && (main(o) ? hasMainPart(o) || kivParts(o).length === 0 : true)) },
];

// order.shipmentDate is stored as free-form text (see supabase/migrations/0001,
// 0002, 0065) as a timestamp — its Malaysian calendar day (toMalaysiaDay,
// the same day `formatDate` shows elsewhere) is what the shipment-date
// filter below compares, like for like with the <input type="date"> value
// (always "YYYY-MM-DD").
function shipmentDateKey(shipmentDate) {
  const d = toMalaysiaDay(shipmentDate);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The Type filter (Sean, 2026-10-23): what a card is — its crystals (the KIV & ARTWORK / crystal
// card), a Tambahan of another order, an order's plaques when its crystals have their own card
// (ACARA), or an ordinary order.
const CARD_TYPES = [['crystal', 'CRYSTAL'], ['addon', 'ADD ON'], ['acara', 'ACARA'], ['normal', 'Normal']];
function cardTypeOf(o) {
  const crystal = kivParts(o).includes('CRYSTAL');
  if (o._part === 'kiv' && crystal) return 'crystal';
  if (o.parentOrderId) return 'addon';
  if (o._part !== 'kiv' && crystal) return 'acara';
  return 'normal';
}

export default function ProductionDashboard() {
  const { state, today, markProductionDone, markTypingDone, markReviewDone, markAddOnReviewed, markKivDone, markKivProductionDone } = useAppState();
  const navigate = useNavigate();
  // The team's own accounts (kesin, sean …) open on Reviewing Order — their
  // first job (Sean, 2026-10-07); the manager (production@pjsb.com) opens on
  // Typing (Sean, 2026-10-13).
  const [tab, setTab] = useState(state.isProductionManager ? 'typing' : 'reviewing');
  // Lets Production see, at a glance, everything due out on one shipment
  // date — useful across all three tabs (what's coming up in Pending
  // Invoice, what's ready to ship today, what already went out).
  const [shipmentDateFilter, setShipmentDateFilter] = useState('');
  const [cardTypeFilter, setCardTypeFilter] = useState('');
  // Search Order (Sean, 2026-10-15): Order ID, Invoice Number, school or salesman, across every
  // tab — the orders this account may see (RLS: the manager all, a team account its salesmen's).
  // ponytail: searches the loaded orders (fetchOrders' newest 500); add a server-side ilike
  // search once Production sees more than that.
  const [search, setSearch] = useState('');
  const searching = !!search.trim();


  const lowStockAlerts = getLowStockAlerts(state.plakCatalog);

  // A split order (orders.invoice_groups, 0070) shows one card per invoice
  // it's actually billed under, not one card for the whole order — same
  // treatment as StoreAdminDashboard.jsx. Each "slice" carries its own
  // invoiceId/totalAmount/totalQty/status but is otherwise the same order
  // (same id, sekolah, shipment date, ...), see getOrderInvoiceSlices —
  // `status` overrides the order's own so a split order's invoices can be
  // marked done independently (markProductionDone, AppState.jsx) and each
  // card lands in the right tab on its own. An un-split order still comes
  // back as exactly one slice unchanged, so this is a no-op for the vast
  // majority of orders.
  // ponytail: the KIV & ARTWORK card follows the order's first (default)
  // invoice slice; a split order's other invoices only carry plaques.
  const orderSlices = useMemo(() => state.orders.flatMap((ord) => {
    const slices = getOrderInvoiceSlices(ord, state.plakCatalog).map((slice, i) => ({
      ...ord, invoiceId: slice.invoiceId, totalAmount: slice.totalAmount, totalQty: slice.totalQty,
      priceAdjusted: slice.priceAdjusted, status: slice.status, typedAt: slice.typedAt,
      _sliceKey: `${ord.id}::${slice.invoiceId || 'default'}`, _primarySlice: i === 0, _part: 'main',
    }));
    const kivCard = kivParts(ord).length > 0 && slices[0]
      ? [{ ...slices[0], _sliceKey: `${slices[0]._sliceKey}::kiv`, _part: 'kiv' }]
      : [];
    return [...slices, ...kivCard];
  }), [state.orders, state.plakCatalog]);

  const activeTab = TABS.find((t) => t.key === tab);
  const ordersInTab = orderSlices.filter((o) => activeTab.match(o, today));
  // the tab a card belongs to: its buttons are that tab's ('' = none, e.g. Cancelled: View Order only)
  const cardTabOf = (o) => (searching ? TABS.find((t) => t.match(o, today))?.key || '' : tab);
  // Searching (Sean, 2026-10-17): the matching orders' cards, from every tab — a KIV & ARTWORK
  // card only while it's in a tab; an order in no tab (Cancelled …) still shows its main card.
  // A main card in no tab whose order's KIV card shows (all crystal / Reserved, nothing to type —
  // ORD-0084, Sean 2026-10-20) is left out, as in the tabs.
  const kivCardShown = (o) => orderSlices.some((k) => k._part === 'kiv' && k.id === o.id && cardTabOf(k));
  // a Tambahan's cards next to its parent's (keepTambahanWithParent)
  const filteredOrders = keepTambahanWithParent(searching
    ? orderSlices.filter((o) => matchesOrderSearch(o, search) && (o._part === 'main' ? !!cardTabOf(o) || !kivCardShown(o) : cardTabOf(o)))
    : prioritizeUrgentOrders(byInvoiceDate(ordersInTab, (o) => invoiceDate(invoiceSource(o, state.orders))?.getTime() ?? null)
      .filter((o) => !shipmentDateFilter || shipmentDateKey(o.shipmentDate) === shipmentDateFilter)
      .filter((o) => !cardTypeFilter || cardTypeOf(o) === cardTypeFilter)));

  // Only shipment dates that actually have an order in this tab are
  // selectable — production shouldn't be able to pick a date with nothing
  // to show.
  const shipmentDateOptions = [...ordersInTab.reduce((map, o) => {
    const key = shipmentDateKey(o.shipmentDate);
    if (key && !map.has(key)) map.set(key, o.shipmentDate);
    return map;
  }, new Map())].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Production Orders</div>
          <p className="hint-text" style={{ margin: 0 }}>Open an order and export each category's CSV for the AI file — no need to wait for an invoice number.</p>
        </div>
        {/* the website's own Crystal Studio (public/crystal/): templates and school logos, editable by Production / Admin */}
        <a href="/crystal/index.html" target="_blank" rel="noreferrer" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
          Crystal Studio
        </a>
      </div>

      {lowStockAlerts.length > 0 && (
        <div className="card" style={{ borderColor: '#d98c00', marginBottom: 'var(--space-4)' }}>
          <div className="card-kicker" style={{ color: '#d98c00' }}>⚠ Low Stock</div>
          <p className="hint-text" style={{ marginBottom: 'var(--space-2)' }}>
            These Jenis Plak codes are at or below 40% of their last-set Stock Qty. A code at or below 20% is auto-hidden from teachers until restocked. Click one to jump straight to it in the catalog.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {lowStockAlerts.map((a) => (
              <li key={a.label}>
                <button
                  type="button"
                  className="btn-link"
                  style={{ color: a.hidden ? '#c0392b' : '#d98c00', fontWeight: a.hidden ? 700 : 400 }}
                  onClick={() => navigate('/production/catalog', { state: { highlightNodeId: a.nodeId } })}
                >
                  {a.label}{a.sharedWith > 0 ? ` (shared with ${a.sharedWith} other code${a.sharedWith > 1 ? 's' : ''})` : ''}: {a.stockQty} / {a.stockBaseline} left ({Math.round((a.stockQty / a.stockBaseline) * 100)}%){a.hidden ? ' — hidden from teachers' : ''}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.productionToast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {state.productionToast}
        </div>
      )}

      <div className="field" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <label htmlFor="productionOrderSearch">Search Order</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>🔍</span>
          <input
            className="input" id="productionOrderSearch" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Order ID, Invoice Number, school or salesman — e.g. SK Sungai"
            style={{ flex: 1 }}
          />
          {search && <button type="button" className="btn btn-ghost" onClick={() => setSearch('')}>✕ Clear</button>}
        </div>
      </div>

      {searching ? (
        <>
          <div className="card-kicker">Search results ({filteredOrders.length})</div>
          {filteredOrders.length === 0 && <p className="hint-text">No order matches “{search.trim()}”.</p>}
        </>
      ) : (
        <>
      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => {
          const count = orderSlices.filter((o) => t.match(o, today)).length;
          return (
            <button
              key={t.key}
              type="button"
              className={`btn ${t.key === tab ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab(t.key); setShipmentDateFilter(''); }}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card-kicker">{activeTab.label}</div>
      <div className="field" style={{ maxWidth: 260, margin: 'var(--space-3) 0 var(--space-4)' }}>
        <label htmlFor="shipmentDateFilter">Filter by Shipment Date</label>
        <select
          className="input"
          id="shipmentDateFilter"
          value={shipmentDateFilter}
          onChange={(e) => setShipmentDateFilter(e.target.value)}
          disabled={shipmentDateOptions.length === 0}
        >
          <option value="">All dates ({ordersInTab.length})</option>
          {shipmentDateOptions.map(([key, rawDate]) => (
            <option key={key} value={key}>{formatDate(toMalaysiaDay(rawDate))}</option>
          ))}
        </select>
      </div>
      <div className="field" style={{ maxWidth: 260, margin: '0 0 var(--space-4)' }}>
        <label htmlFor="cardTypeFilter">Type</label>
        <select className="input" id="cardTypeFilter" value={cardTypeFilter} onChange={(e) => setCardTypeFilter(e.target.value)}>
          <option value="">All ({ordersInTab.length})</option>
          {CARD_TYPES.map(([key, label]) => (
            <option key={key} value={key}>{label} ({ordersInTab.filter((o) => cardTypeOf(o) === key).length})</option>
          ))}
        </select>
      </div>
      {filteredOrders.length === 0 && <p className="hint-text">No orders in this stage.</p>}
        </>
      )}
      <div className="order-grid">
        {filteredOrders.map((ord) => {
          const stamp = getOrderChangeStamp(ord);
          const cardTab = cardTabOf(ord);
          // Add-On Review: the card is the Tambahan alone — its own qty, amount, Shipment Date (Sean, 2026-10-17)
          const addonCard = cardTab === 'addon';
          const addonItems = addonCard ? ord.pendingAddonItems || [] : [];
          const shownQty = addonCard ? addonItems.reduce((n, it) => n + (Number(it.qty) || 0), 0) : ord.totalQty;
          const shownAmount = addonCard ? addonItems.reduce((n, it) => n + (Number(it.harga) || 0), 0) : ord.totalAmount;
          const shownShip = addonCard && ord.pendingAddonShipmentDate ? ord.pendingAddonShipmentDate : ord.shipmentDate;
          const isKivCard = ord._part === 'kiv';
          const parts = kivParts(ord);
          const reserved = countReservedPlaques(ord);
          // The main card says what its order's KIV & ARTWORK card is still waiting on.
          const kivPending = !isKivCard && ord._primarySlice && ord.status === 'In Production'
            && (needsKiv(ord) || kivInProduction(ord));

          return (
            <div key={ord._sliceKey} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                  <AddOnTag order={ord} pending={addonCard} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  {/* Production uploaded a corrected copy of the teacher's
                      file (see ProductionOrderDetail's CorrectedExcelControl)
                      — flagged here so it's visible without opening the
                      order, per Sean: don't check against the teacher's original upload. */}
                  {ord.correctedImportFilePath && (
                    <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>Excel Updated</span>
                  )}
                  <OrderUrgentBadge urgent={ord.urgent} />
                  <span className="status-pill" style={statusPillStyle(partDone(ord) ? 'Completed' : ord.status)}>
                    {partDone(ord) ? 'Completed' : isKivCard
                      ? (kivInTyping(ord) ? 'Typing' : needsKiv(ord) ? 'KIV & ARTWORK' : ord.status)
                      : (ord.status === 'In Production' && !ord.typedAt ? 'Typing' : ord.status)}
                  </span>
                  {isKivCard && reserved > 0 && (
                    <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>RESERVED ×{reserved}</span>
                  )}
                  {ord.status === 'Reviewing Order' && ord.reviewedAt && (
                    <span className="status-pill" style={{ background: '#dcefe3', color: '#2f6b4f' }}>✓ Review Done</span>
                  )}
                  {cardTab === 'addon' && (ord.pendingAddonStatus === 'reviewed'
                    ? <span className="status-pill" style={{ background: '#dcefe3', color: '#2f6b4f' }}>✓ Review Done — waiting for Sales</span>
                    : <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>Tambahan — needs review</span>)}
                </div>
              </div>
              {stamp && <div className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>{stamp}</div>}
              {/* submitted although it looked like another order of the school (0094) */}
              {!isKivCard && ord.duplicateCheck && (
                <div className="hint-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#b45309' }}>
                  ⚠ Possible duplicate: {duplicateSummary(ord.duplicateCheck)}
                  <div style={{ fontWeight: 400 }}>Submitted anyway by {ord.duplicateCheck.confirmedBy || '—'}</div>
                </div>
              )}
              {/* The KIV & ARTWORK card: SHORT SUPPLY (Reserved plaques) and/or CRYSTAL — Sean, 2026-10-14 */}
              {/* KIV & ARTWORK only waits (Sean, 2026-10-17): no Done — it leaves once the Reserved
                  names are filled in and the crystals' artwork is confirmed. In Typing the
                  late-named plaques need no SHORT SUPPLY tag. */}
              {isKivCard && parts.filter((part) => cardTab !== 'typing' || part !== 'SHORT SUPPLY').map((part) => (
                <div key={part} className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>{part}</div>
              ))}
              {/* The order's plaques card, when its crystals have their own card: ACARA (Sean, 2026-10-21) */}
              {!isKivCard && !addonCard && parts.includes('CRYSTAL') && <div className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>ACARA</div>}
              {kivPending && !addonCard && parts.includes('SHORT SUPPLY') && <div className="hint-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#8a6d00' }}>Waiting: SHORT SUPPLY</div>}
              {isKivCard && parts.includes('CRYSTAL') && !ord.artworkConfirmedAt && (
                <div className="hint-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#b45309' }}>Artwork not confirmed yet</div>
              )}
              {isKivCard && parts.includes('CRYSTAL') && ord.artworkConfirmedAt && ord.artworkManual && (
                <div className="hint-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#b45309' }}>{MANUAL_ARTWORK_NOTE}</div>
              )}

              <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
              </div>
              <div className="order-card-meta">
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                <div><div className="dim">Shipment Date</div><div>{shownShip ? formatDate(toMalaysiaDay(shownShip)) : '—'}</div></div>
                <div>
                  <div className="dim">{addonCard ? 'Tambahan QTY' : 'Total QTY'}</div>
                  <div className="order-card-qty">{shownQty}</div>
                </div>
              </div>

              <div className="order-card-invoice"><span className="dim">Invoice ID:</span> {invoiceLabel(invoiceSource(ord, state.orders)) || '—'}</div>
              {cardTab === 'approved' && <ProductionInvoiceEntry order={ord} />}
              <div className="dim" style={{ fontSize: 11 }}>{addonCard ? 'Tambahan Amount' : 'Total Amount'}</div>
              <div className={`order-card-total${!addonCard && ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {shownAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              <div className="order-card-actions" style={cardTab === 'active' || cardTab === 'typing' || cardTab === 'reviewing' || cardTab === 'addon' || cardTab === 'kiv' ? { display: 'flex', gap: 'var(--space-2)' } : undefined}>
                {cardTab === 'reviewing' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}`)}>
                      View Order
                    </button>
                    {!ord.reviewedAt && (
                      <ConfirmButton
                        label="Done Review" style={{ flex: 1 }}
                        question="Finished reviewing? The salesman can approve it after this."
                        onConfirm={() => markReviewDone(ord.id)}
                      />
                    )}
                  </>
                )}
                {cardTab === 'addon' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}?addon=1`)}>
                      View Order
                    </button>
                    {ord.pendingAddonStatus === 'pending' && (
                      <ConfirmButton
                        label="Done Review" style={{ flex: 1 }}
                        question="Finished reviewing this Tambahan? The salesman can approve it after this."
                        onConfirm={() => markAddOnReviewed(ord.id)}
                      />
                    )}
                  </>
                )}
                {cardTab === 'typing' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}${isKivCard ? '?part=kiv' : ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                      View Order
                    </button>
                    <ConfirmButton
                      label="Done Typing" style={{ flex: 1 }}
                      question="Finished typing? It moves to In Production, ready to print."
                      onConfirm={() => (isKivCard ? markKivDone(ord.id) : markTypingDone(ord.id, ord.invoiceId))}
                    />
                  </>
                )}
                {cardTab === 'kiv' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}?kiv=1`)}>
                      View Order
                    </button>
                  </>
                )}
                {cardTab === 'active' && (
                  <>
                    {/* ?invoice= tells ProductionOrderDetail which slice this
                        card represents (see getOrderInvoiceSlices) — a
                        no-op for an un-split order. A Tambahan (parentOrderId)
                        is billed under its original's invoice, so it never
                        waits for one of its own. */}
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                      View Order
                    </button>
                    <ConfirmButton
                      label={ord.invoiceId || ord.parentOrderId ? 'Done' : 'Awaiting Invoice'} style={{ flex: 1 }}
                      disabled={!ord.invoiceId && !ord.parentOrderId}
                      title={!ord.invoiceId && !ord.parentOrderId ? 'Waiting for Store Admin to assign an Invoice Number' : undefined}
                      question={isKivCard
                        ? `${parts.join(' + ')} done?`
                        : kivPending
                          ? `Plaques done? The order moves on once its ${parts.join(' + ')} is done too.`
                          : 'Mark as done? Status → "Completed".'}
                      onConfirm={() => (isKivCard ? markKivProductionDone(ord.id) : markProductionDone(ord.id, ord.invoiceId))}
                    />
                  </>
                )}
                {cardTab !== 'active' && cardTab !== 'typing' && cardTab !== 'reviewing' && cardTab !== 'addon' && cardTab !== 'kiv' && (
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                    View Order
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
