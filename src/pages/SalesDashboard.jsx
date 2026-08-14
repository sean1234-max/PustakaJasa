import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

// Sales works one stage at a time — filter tabs map 1:1 to STATUS_STAGES,
// except the first stage is relabeled "Waiting for Approve" since that's
// the action Sales actually takes on it. The add-on tab is separate from
// the order's main status pipeline — an add-on can be submitted while the
// order is already "In Production" or later, so it's filtered on
// pendingAddonStatus instead of ord.status.
const ADDON_FILTER = 'PENDING_ADDON';
const FILTERS = [
  { status: 'Submitted to Sales', label: 'Waiting for Approve' },
  { status: ADDON_FILTER, label: 'Add-On Pending Approval' },
  { status: 'In Production', label: 'In Production' },
  { status: 'Waiting for Delivery', label: 'Waiting for Delivery' },
  { status: 'Completed', label: 'Completed' },
];

export default function SalesDashboard() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [filter, setFilter] = useState(FILTERS[0].status);

  const filteredOrders = filter === ADDON_FILTER
    ? state.orders.filter((ord) => ord.pendingAddonStatus === 'pending')
    : state.orders.filter((ord) => ord.status === filter);

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Sales Orders</div>
          <p className="hint-text" style={{ margin: 0 }}>Review incoming orders from every school — check Jenis Plak, quantities, and price per unit before approving.</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {FILTERS.map((f) => {
          const count = f.status === ADDON_FILTER
            ? state.orders.filter((o) => o.pendingAddonStatus === 'pending').length
            : state.orders.filter((o) => o.status === f.status).length;
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
          const idx = STATUS_STAGES.indexOf(ord.status);
          const pendingReview = ord.status === 'Submitted to Sales' || (filter === ADDON_FILTER && ord.pendingAddonStatus === 'pending');

          return (
            <div key={ord.id} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
              </div>
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

              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>
                RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>

              <div className="order-card-actions">
                <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(`/sales/orders/${ord.id}`)}>
                  {filter === ADDON_FILTER ? 'Review Add-On' : pendingReview ? 'Review Order' : 'View Summary'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
