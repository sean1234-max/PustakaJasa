import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, isAddonInFlight, invoiceLabel } from '../data/catalog';
import { matchesOrderSearch } from '../utils/orderSearch';
import OrderUrgentBadge from '../components/OrderUrgentBadge';
import AddOnTag from '../components/AddOnTag';
import { prioritizeUrgentOrders } from '../utils/urgentOrder';
import ConfirmButton from '../components/ConfirmButton';
import { countReservedPlaques, isCrystalCode } from '../utils/exportCsv';

// Sales works one stage at a time — filter tabs map 1:1 to STATUS_STAGES.
// A 'Reviewing Order' order can only be approved once Production has
// clicked Done Review (order.reviewedAt — shown on the card). The add-on tab is separate from
// the order's main status pipeline — an add-on can be submitted while the
// order is already "In Production" or later, so it's filtered on
// pendingAddonStatus instead of ord.status.
const ADDON_FILTER = 'PENDING_ADDON';
const FILTERS = [
  { status: 'Reviewing Order', label: 'Reviewing Order' },
  { status: ADDON_FILTER, label: 'Add-On Pending Approval' },
  { status: 'Salesman Approved', label: 'Salesman Approved' },
  { status: 'In Production', label: 'In Production' },
  { status: 'Completed', label: 'Completed' },
];

export default function SalesDashboard() {
  const { state, openAmend, openAddOn, confirmArtwork } = useAppState();
  const [artworkErr, setArtworkErr] = useState({});
  const navigate = useNavigate();
  const [filter, setFilter] = useState(FILTERS[0].status);
  // A Sales Manager's `state.orders` already contains every salesman's
  // orders (RLS — supabase/migrations/0048_sales_manager.sql); this dropdown
  // just narrows the view to one salesman. A regular salesman only ever has
  // their own, so it isn't shown for them.
  const isManager = !!state.isSalesManager;
  const [salesmanFilter, setSalesmanFilter] = useState('all');
  const [search, setSearch] = useState('');
  // RLS already limits state.orders to this salesman's own orders (a Sales
  // Manager sees everyone's but edits only their own — isOwn below).
  // ponytail: searches the loaded orders (fetchOrders' newest 500); add a
  // server-side ilike search if a salesman ever has more than that.
  const searching = !!search.trim();

  // Before approval: Update Details; after: Add On only (Sean, 2026-10-09).
  const actionsFor = (ord) => {
    const isOwn = !state.isSalesManager || ord.salesmanId === state.userAuthId;
    return {
      canAmend: isOwn && ord.status === 'Reviewing Order',
      // a Tambahan's own order takes no add-on of its own — add to the original (0091)
      canAddOn: isOwn && ['Salesman Approved', 'In Production', 'Completed'].includes(ord.status) && !isAddonInFlight(ord) && !ord.parentOrderId,
    };
  };
  const startAmend = (ord) => { openAmend(ord); navigate(`/amend/${ord.id}`); };
  const startAddOn = (ord) => { openAddOn(ord); navigate(`/addon/${ord.id}`); };
  const salesmanOptions = useMemo(
    () => [...new Set((state.orders || []).map((o) => o.sales).filter(Boolean))].sort(),
    [state.orders],
  );

  const byStage = filter === ADDON_FILTER
    ? state.orders.filter((ord) => isAddonInFlight(ord))
    : state.orders.filter((ord) => ord.status === filter);
  // Searching (Sean, 2026-10-17 — same as Production's): the matching orders' cards from every
  // stage, each with its own stage's buttons (cardFilterOf).
  const shown = searching ? state.orders.filter((ord) => matchesOrderSearch(ord, search)) : byStage;
  const filteredOrders = prioritizeUrgentOrders(isManager && salesmanFilter !== 'all'
    ? shown.filter((ord) => ord.sales === salesmanFilter)
    : shown);
  const cardFilterOf = (ord) => {
    if (!searching) return filter;
    return isAddonInFlight(ord) ? ADDON_FILTER : ord.status;
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Sales Orders</div>
          <p className="hint-text" style={{ margin: 0 }}>
            {isManager
              ? 'As a Sales Manager you see every salesman’s orders. You can review any order, but only approve / edit your own.'
              : 'Review incoming orders from every school — check Jenis Plak, quantities, and price per unit before approving.'}
          </p>
        </div>
      </div>

      {isManager && (
        <div className="field" style={{ maxWidth: 320, marginBottom: 'var(--space-4)' }}>
          <label htmlFor="salesmanFilter">Salesman</label>
          <select className="input" id="salesmanFilter" value={salesmanFilter} onChange={(e) => setSalesmanFilter(e.target.value)}>
            <option value="all">All Salesmen</option>
            {salesmanOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      <div className="field" style={{ maxWidth: 520, marginBottom: 'var(--space-4)' }}>
        <label htmlFor="orderSearch">Search Order</label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span aria-hidden="true" style={{ fontSize: 18 }}>🔍</span>
          <input
            className="input" id="orderSearch" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
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
            {FILTERS.map((f) => {
              const scope = isManager && salesmanFilter !== 'all'
                ? state.orders.filter((o) => o.sales === salesmanFilter)
                : state.orders;
              const count = f.status === ADDON_FILTER
                ? scope.filter((o) => isAddonInFlight(o)).length
                : scope.filter((o) => o.status === f.status).length;
              return (
                <button
                  key={f.status}
                  type="button"
                  className={`btn ${f.status === filter ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setFilter(f.status)}
                >
                  {f.label} ({count})
                </button>
              );
            })}
          </div>

          <div className="card-kicker">{FILTERS.find((f) => f.status === filter)?.label}</div>
          {filteredOrders.length === 0 && <p className="hint-text">No orders in this stage.</p>}
        </>
      )}
          <div className="order-grid">
            {filteredOrders.map((ord) => {
              const cardFilter = cardFilterOf(ord);
              // Add-On Pending Approval: the card's amount is the Tambahan alone (Sean, 2026-10-17)
              const addonCard = cardFilter === ADDON_FILTER;
              const shownAmount = addonCard ? (ord.pendingAddonItems || []).reduce((n, it) => n + (Number(it.harga) || 0), 0) : ord.totalAmount;
              const readyToApprove = ord.status === 'Reviewing Order' && !!ord.reviewedAt;
              const pendingReview = readyToApprove || (cardFilter === ADDON_FILTER && isAddonInFlight(ord));
              const { canAmend, canAddOn } = actionsFor(ord);
              // Sean, 2026-10-17: what the salesman still owes this order, on its card
              const live = !['Cancelled', 'Completed'].includes(ord.status);
              const needsArtwork = live && !ord.artworkConfirmedAt && (ord.items || []).some((it) => isCrystalCode(it.jenisPlak));
              const needsKiv = ord.status === 'In Production' && countReservedPlaques(ord) > 0;

              return (
                <div key={ord.id} className="card order-card">
                  <div className="order-card-top">
                    <div>
                      <div className="order-card-label">Order ID</div>
                      <div className="order-card-id">{ord.id}</div>
                      <AddOnTag order={ord} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <OrderUrgentBadge urgent={ord.urgent} />
                      <span className="status-pill" style={statusPillStyle(ord.status)}>{ord.status}</span>
                    </div>
                  </div>
                  {ord.status === 'Reviewing Order' && (
                    <span className="status-pill" style={{ ...(readyToApprove ? { background: '#dcefe3', color: '#2f6b4f' } : { background: '#f1f1f1', color: '#555' }), marginTop: 'var(--space-2)' }}>
                      {readyToApprove ? '✓ Review Done — ready to approve' : 'Production is reviewing'}
                    </span>
                  )}
                  {/* Production uploaded a corrected copy of the teacher's file
                      (see ProductionOrderDetail's CorrectedExcelControl) — Order
                      Details on this order's own page already reads from it. */}
                  {ord.correctedImportFilePath && (
                    <span className="status-pill" style={{ background: '#fff4ce', color: '#8a6d00', marginTop: 'var(--space-2)' }}>Excel Updated</span>
                  )}
                  {cardFilter === ADDON_FILTER && (
                    <span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)', marginTop: 'var(--space-2)' }}>Add-On Pending</span>
                  )}

                  <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                    <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
                  </div>
                  <div className="order-card-meta">
                    <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                    <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                  </div>

                  <div className="order-card-invoice"><span className="dim">Invoice Number:</span> {invoiceLabel(ord) || '—'}</div>
                  <div className="dim" style={{ fontSize: 11 }}>{addonCard ? 'Tambahan Amount' : 'Total Amount'}</div>
                  <div className={`order-card-total${!addonCard && ord.priceAdjusted ? ' amount-adjusted' : ''}`}>
                    RM {shownAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>

                  <div className="order-card-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate(`/sales/orders/${ord.id}${cardFilter === ADDON_FILTER ? '?addon=1' : ''}`)}>
                      {cardFilter === ADDON_FILTER ? 'Review Add-On' : pendingReview ? 'Approve Order' : 'View Summary'}
                    </button>
                    {canAmend && (
                      <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => startAmend(ord)}>Update Details</button>
                    )}
                    {canAddOn && (
                      <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => startAddOn(ord)}>Add On</button>
                    )}
                  </div>
                  {(needsArtwork || needsKiv) && (
                    <div className="order-card-actions" style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                      {needsArtwork && (
                        <ConfirmButton
                          label="Confirm Artwork" style={{ flex: 1 }}
                          question="Is the crystal artwork correct (design, words, logo)? Check it in View Summary → Crystal Preview first. The crystals then go to Production."
                          confirmLabel="Yes, confirm" cancelLabel="Not yet"
                          onConfirm={async () => {
                            const err = await confirmArtwork(ord.id);
                            setArtworkErr((e) => ({ ...e, [ord.id]: err || '' }));
                          }}
                        />
                      )}
                      {needsKiv && (
                        <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => navigate(`/sales/orders/${ord.id}?kiv=1`)}>
                          Update KIV
                        </button>
                      )}
                    </div>
                  )}
                  {artworkErr[ord.id] && <p className="hint-text" style={{ color: '#b91c1c' }}>{artworkErr[ord.id]}</p>}
                </div>
              );
            })}
          </div>
    </div>
  );
}
