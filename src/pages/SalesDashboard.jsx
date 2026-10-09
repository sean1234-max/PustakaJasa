import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, isAddonInFlight, formatDate, toMalaysiaDay } from '../data/catalog';
import { matchesOrderSearch } from '../utils/orderSearch';
import OrderUrgentBadge from '../components/OrderUrgentBadge';
import { prioritizeUrgentOrders } from '../utils/urgentOrder';

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
  { status: 'Waiting for Shipment', label: 'Waiting for Shipment' },
  { status: 'Shipped', label: 'Shipped' },
  { status: 'Completed', label: 'Completed' },
];

export default function SalesDashboard() {
  const { state, openAmend, openAddOn } = useAppState();
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
  const searchResults = search.trim() ? state.orders.filter((ord) => matchesOrderSearch(ord, search)) : null;

  // Before approval: Update Details; after: Add On only (Sean, 2026-10-09).
  const actionsFor = (ord) => {
    const isOwn = !state.isSalesManager || ord.salesmanId === state.userAuthId;
    return {
      canAmend: isOwn && ord.status === 'Reviewing Order',
      canAddOn: isOwn && ['Salesman Approved', 'In Production'].includes(ord.status) && !isAddonInFlight(ord),
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
  const filteredOrders = prioritizeUrgentOrders(isManager && salesmanFilter !== 'all'
    ? byStage.filter((ord) => ord.sales === salesmanFilter)
    : byStage);

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

      <div className="field" style={{ maxWidth: 480, marginBottom: 'var(--space-4)' }}>
        <label htmlFor="orderSearch">Search Order</label>
        <input
          className="input" id="orderSearch" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="School name, Invoice Number or Order ID — e.g. SK Sungai"
        />
      </div>

      {searchResults ? (
        <>
          <div className="card-kicker">Search results ({searchResults.length})</div>
          {searchResults.length === 0 ? (
            <p className="hint-text">No order matches “{search.trim()}”.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead><tr><th>Order ID</th><th>School</th><th>Invoice Number</th><th>Shipment Date</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {searchResults.map((ord) => {
                    const { canAmend, canAddOn } = actionsFor(ord);
                    return (
                      <tr key={ord.id}>
                        <td>{ord.id}</td>
                        <td>{ord.sekolah || '—'}</td>
                        <td>{[ord.invoiceId, ...(ord.invoiceGroups || []).map((g) => g.invoiceId)].filter(Boolean).join(', ') || '—'}</td>
                        <td>{ord.shipmentDate ? formatDate(toMalaysiaDay(ord.shipmentDate)) : '—'}</td>
                        <td><span className="status-pill" style={statusPillStyle(ord.status)}>{ord.status}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-ghost" onClick={() => navigate(`/sales/orders/${ord.id}`)}>View</button>
                            {canAmend && <button type="button" className="btn btn-secondary" onClick={() => startAmend(ord)}>Update Details</button>}
                            {canAddOn && <button type="button" className="btn btn-secondary" onClick={() => startAddOn(ord)}>Add On</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
          <div className="order-grid">
            {filteredOrders.map((ord) => {
              const readyToApprove = ord.status === 'Reviewing Order' && !!ord.reviewedAt;
              const pendingReview = readyToApprove || (filter === ADDON_FILTER && isAddonInFlight(ord));
              const { canAmend, canAddOn } = actionsFor(ord);

              return (
                <div key={ord.id} className="card order-card">
                  <div className="order-card-top">
                    <div>
                      <div className="order-card-label">Order ID</div>
                      <div className="order-card-id">{ord.id}</div>
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
                  {filter === ADDON_FILTER && (
                    <span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)', marginTop: 'var(--space-2)' }}>Add-On Pending</span>
                  )}

                  <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                    <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
                  </div>
                  <div className="order-card-meta">
                    <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                    <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                  </div>

                  <div className="order-card-invoice"><span className="dim">Invoice Number:</span> {ord.invoiceId || '—'}</div>
                  <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
                  <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>
                    RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>

                  <div className="order-card-actions" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => navigate(`/sales/orders/${ord.id}`)}>
                      {filter === ADDON_FILTER ? 'Review Add-On' : pendingReview ? 'Approve Order' : 'View Summary'}
                    </button>
                    {canAmend && (
                      <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => startAmend(ord)}>Update Details</button>
                    )}
                    {canAddOn && (
                      <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => startAddOn(ord)}>Add On</button>
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
