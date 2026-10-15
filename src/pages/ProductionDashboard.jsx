import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import ConfirmButton from '../components/ConfirmButton';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, getLowStockAlerts, toMalaysiaDay, isAddonInFlight, invoiceLabel } from '../data/catalog';
import { getOrderChangeStamp } from '../utils/orderStamp';
import { getOrderInvoiceSlices } from '../utils/orderBatches';
import { countReservedPlaques, needsKiv, kivParts, hasPlakPart, kivInProduction } from '../utils/exportCsv';
import { prioritizeUrgentOrders } from '../utils/urgentOrder';
import OrderUrgentBadge from '../components/OrderUrgentBadge';
import AddOnTag from '../components/AddOnTag';
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
const TABS = [
  { key: 'reviewing', label: 'Reviewing Order', match: (o) => main(o) && o.status === 'Reviewing Order' },
  // A submitted add-on (0085) — one card per order (its first invoice slice),
  // whatever the order's own status. Like Reviewing Order, it stays here
  // after Done Review until the salesman approves it.
  { key: 'addon', label: 'Add-On Review', match: (o) => main(o) && o._primarySlice && isAddonInFlight(o) },
  { key: 'approved', label: 'Salesman Approved', match: (o) => main(o) && o.status === 'Salesman Approved' },
  { key: 'typing', label: 'Typing', match: (o) => main(o) && o.status === 'In Production' && hasPlakPart(o) && !o.typedAt },
  { key: 'kiv', label: 'KIV & ARTWORK', match: (o) => o._part === 'kiv' && o.status === 'In Production' && needsKiv(o) },
  {
    key: 'active',
    label: 'In Production',
    match: (o) => o.status === 'In Production' && (main(o)
      ? hasPlakPart(o) && !!o.typedAt && !(o._primarySlice && o.plakDoneAt)
      : kivInProduction(o)),
  },
  { key: 'completed', label: 'Completed', match: (o) => main(o) && o.status === 'Completed' },
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
  // Search Order (Sean, 2026-10-15): Order ID, Invoice Number, school or salesman, across every
  // tab — the orders this account may see (RLS: the manager all, a team account its salesmen's).
  // ponytail: searches the loaded orders (fetchOrders' newest 500); add a server-side ilike
  // search once Production sees more than that.
  const [search, setSearch] = useState('');
  const searchResults = search.trim() ? state.orders.filter((ord) => matchesOrderSearch(ord, search)) : null;


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
  const filteredOrders = prioritizeUrgentOrders(ordersInTab
    .filter((o) => !shipmentDateFilter || shipmentDateKey(o.shipmentDate) === shipmentDateFilter));

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

      {searchResults ? (
        <>
          <div className="card-kicker">Search results ({searchResults.length})</div>
          {searchResults.length === 0 ? (
            <p className="hint-text">No order matches “{search.trim()}”.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Order ID</th><th>Invoice Number</th><th>School</th><th>Salesman</th><th>Shipment Date</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {searchResults.map((ord) => (
                    <tr key={ord.id}>
                      <td>{ord.id}</td>
                      <td>{[ord.invoiceId, ...(ord.invoiceGroups || []).map((g) => g.invoiceId)].filter(Boolean).map((inv) => invoiceLabel(ord, inv)).join(', ') || '—'}</td>
                      <td>{ord.sekolah || '—'}</td>
                      <td>{ord.sales || '—'}</td>
                      <td>{ord.shipmentDate ? formatDate(toMalaysiaDay(ord.shipmentDate)) : '—'}</td>
                      <td><span className="status-pill" style={statusPillStyle(ord.status)}>{ord.status}</span></td>
                      <td>
                        <button type="button" className="btn btn-ghost" onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                          View Order
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
      {filteredOrders.length === 0 && <p className="hint-text">No orders in this stage.</p>}
      <div className="order-grid">
        {filteredOrders.map((ord) => {
          const stamp = getOrderChangeStamp(ord);
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
                  <AddOnTag order={ord} />
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
                  <span className="status-pill" style={statusPillStyle(ord.status)}>
                    {isKivCard
                      ? (needsKiv(ord) ? 'KIV & ARTWORK' : ord.status)
                      : (ord.status === 'In Production' && !ord.typedAt ? 'Typing' : ord.status)}
                  </span>
                  {isKivCard && reserved > 0 && (
                    <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00' }}>RESERVED ×{reserved}</span>
                  )}
                  {ord.status === 'Reviewing Order' && ord.reviewedAt && (
                    <span className="status-pill" style={{ background: '#dcefe3', color: '#2f6b4f' }}>✓ Review Done</span>
                  )}
                  {tab === 'addon' && (ord.pendingAddonStatus === 'reviewed'
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
              {isKivCard && parts.map((part) => (
                <div key={part} className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>{part}</div>
              ))}
              {kivPending && <div className="hint-text" style={{ margin: '4px 0 0', fontWeight: 600, color: '#8a6d00' }}>Waiting: {parts.join(' / ')}</div>}

              <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
              </div>
              <div className="order-card-meta">
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                <div><div className="dim">Shipment Date</div><div>{ord.shipmentDate ? formatDate(toMalaysiaDay(ord.shipmentDate)) : '—'}</div></div>
                <div>
                  <div className="dim">Total QTY</div>
                  <div className="order-card-qty">{ord.totalQty}</div>
                </div>
              </div>

              <div className="order-card-invoice"><span className="dim">Invoice ID:</span> {invoiceLabel(ord) || '—'}</div>
              {tab === 'approved' && <ProductionInvoiceEntry order={ord} />}
              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              <div className="order-card-actions" style={tab === 'active' || tab === 'typing' || tab === 'reviewing' || tab === 'addon' || tab === 'kiv' ? { display: 'flex', gap: 'var(--space-2)' } : undefined}>
                {tab === 'reviewing' && (
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
                {tab === 'addon' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}`)}>
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
                {tab === 'typing' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                      View Order
                    </button>
                    <ConfirmButton
                      label="Done Typing" style={{ flex: 1 }}
                      question="Finished typing? It moves to In Production, ready to print."
                      onConfirm={() => markTypingDone(ord.id, ord.invoiceId)}
                    />
                  </>
                )}
                {tab === 'kiv' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}?kiv=1`)}>
                      View Order
                    </button>
                    <ConfirmButton
                      label="Done" style={{ flex: 1 }}
                      question={`${parts.join(' + ')} done? It moves to In Production.`}
                      confirmLabel="Yes, done"
                      cancelLabel="No, not yet"
                      onConfirm={() => markKivDone(ord.id)}
                    />
                  </>
                )}
                {tab === 'active' && (
                  <>
                    {/* ?invoice= tells ProductionOrderDetail which slice this
                        card represents (see getOrderInvoiceSlices) — a
                        no-op for an un-split order. */}
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                      View Order
                    </button>
                    <ConfirmButton
                      label={ord.invoiceId ? 'Done' : 'Awaiting Invoice'} style={{ flex: 1 }}
                      disabled={!ord.invoiceId}
                      title={!ord.invoiceId ? 'Waiting for Store Admin to assign an Invoice Number' : undefined}
                      question={isKivCard
                        ? `${parts.join(' + ')} done?`
                        : kivPending
                          ? `Plaques done? The order moves on once its ${parts.join(' + ')} is done too.`
                          : 'Mark as done? Status → "Completed".'}
                      onConfirm={() => (isKivCard ? markKivProductionDone(ord.id) : markProductionDone(ord.id, ord.invoiceId))}
                    />
                  </>
                )}
                {tab !== 'active' && tab !== 'typing' && tab !== 'reviewing' && tab !== 'addon' && tab !== 'kiv' && (
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate(`/production/orders/${ord.id}${ord.invoiceId ? `?invoice=${encodeURIComponent(ord.invoiceId)}` : ''}`)}>
                    View Order
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
        </>
      )}
    </div>
  );
}
