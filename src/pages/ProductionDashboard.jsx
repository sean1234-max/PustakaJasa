import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { statusPillStyle, formatDate, deliveryStageForShipmentDate } from '../data/catalog';
import { getOrderChangeStamp } from '../utils/orderStamp';

// Production works 'In Production' orders (invoice number or not — that's
// Store Admin's job now, see supabase/migrations/0036_add_invoicing_role.sql
// and StoreAdminDashboard.jsx), then follows each order down the
// Shipment-Date-driven tail (see markProductionDone / deliveryStageForShipmentDate).
//
// The Shipped/Completed/Order History split is by the calendar, not a stored
// timestamp. For an order whose Shipment Date is S:
//   on S            -> 'Shipped'          (Shipped tab)
//   S+1 .. S+3      -> 'Completed'        (Completed tab — 3 days)
//   S+4 onwards     -> 'Completed'        (Order History)
// An order marked Done before its Shipment Date sits in 'Waiting for
// Delivery' until the daily sweep flips it; those live in Order History too.

// Whole days from an order's Shipment Date to `today` (0 = due today,
// positive = in the past). null when there's no parseable Shipment Date.
function daysSinceShipmentDate(dueDate, today) {
  if (!dueDate) return null;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return null;
  const ship = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((now - ship) / 86400000);
}

const TABS = [
  { key: 'active', label: 'In Production', match: (o) => o.status === 'In Production' },
  { key: 'shipped', label: 'Shipped', match: (o) => o.status === 'Shipped' },
  {
    key: 'completed',
    label: 'Completed',
    match: (o, today) => {
      if (o.status !== 'Completed') return false;
      const days = daysSinceShipmentDate(o.dueDate, today);
      return days !== null && days <= 3;
    },
  },
  {
    key: 'history',
    label: 'Order History',
    match: (o, today) => {
      if (o.status === 'Waiting for Delivery') return true;
      if (o.status !== 'Completed') return false;
      const days = daysSinceShipmentDate(o.dueDate, today);
      return days === null || days >= 4;
    },
  },
];

// order.dueDate is stored as free-form text (see supabase/migrations/0001,
// 0002) but every order-creation/approval path writes it from a JS Date —
// re-parsing with `new Date(...)` and reading local y/m/d back out gives
// the same plain calendar date `formatDate` shows elsewhere, so the
// delivery-date filter below compares like for like with the <input
// type="date"> value (always "YYYY-MM-DD").
function dueDateKey(dueDate) {
  if (!dueDate) return '';
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ProductionDashboard() {
  const { state, today, markProductionDone } = useAppState();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  // Lets Production see, at a glance, everything due out on one delivery
  // date — useful across all three tabs (what's coming up in Pending
  // Invoice, what's ready to ship today, what already went out).
  const [dueDateFilter, setDueDateFilter] = useState('');

  const handleMarkDone = (ord) => {
    const nextStatus = deliveryStageForShipmentDate(ord.dueDate, today);
    if (!window.confirm(`Mark order ${ord.id} as done? Its status will change to "${nextStatus}".`)) return;
    markProductionDone(ord.id);
  };

  const activeTab = TABS.find((t) => t.key === tab);
  const ordersInTab = state.orders.filter((o) => activeTab.match(o, today));
  const filteredOrders = ordersInTab
    .filter((o) => !dueDateFilter || dueDateKey(o.dueDate) === dueDateFilter);

  // Only due dates that actually have an order in this tab are selectable —
  // production shouldn't be able to pick a date with nothing to show.
  const dueDateOptions = [...ordersInTab.reduce((map, o) => {
    const key = dueDateKey(o.dueDate);
    if (key && !map.has(key)) map.set(key, o.dueDate);
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

      {state.productionToast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {state.productionToast}
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => {
          const count = state.orders.filter((o) => t.match(o, today)).length;
          return (
            <button
              key={t.key}
              type="button"
              className={`btn ${t.key === tab ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab(t.key); setDueDateFilter(''); }}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card-kicker">{activeTab.label}</div>
      <div className="field" style={{ maxWidth: 260, margin: 'var(--space-3) 0 var(--space-4)' }}>
        <label htmlFor="dueDateFilter">Filter by Shipment Date</label>
        <select
          className="input"
          id="dueDateFilter"
          value={dueDateFilter}
          onChange={(e) => setDueDateFilter(e.target.value)}
          disabled={dueDateOptions.length === 0}
        >
          <option value="">All dates ({ordersInTab.length})</option>
          {dueDateOptions.map(([key, rawDate]) => (
            <option key={key} value={key}>{formatDate(new Date(rawDate))}</option>
          ))}
        </select>
      </div>
      {filteredOrders.length === 0 && <p className="hint-text">No orders in this stage.</p>}
      <div className="order-grid">
        {filteredOrders.map((ord) => {
          const stamp = getOrderChangeStamp(ord);

          return (
            <div key={ord.id} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={statusPillStyle(ord.status)}>{ord.status}</span>
              </div>
              {stamp && <div className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>{stamp}</div>}

              <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
              </div>
              <div className="order-card-meta">
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                <div><div className="dim">Shipment Date</div><div>{ord.dueDate ? formatDate(new Date(ord.dueDate)) : '—'}</div></div>
                <div>
                  <div className="dim">Total QTY</div>
                  <div className="order-card-qty">{(ord.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0)}</div>
                </div>
              </div>

              <div className="order-card-invoice"><span className="dim">Invoice ID:</span> {ord.invoiceId || '—'}</div>
              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              <div className="order-card-actions" style={tab === 'active' ? { display: 'flex', gap: 'var(--space-2)' } : undefined}>
                {tab === 'active' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}`)}>
                      View Order
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ flex: 1 }}
                      disabled={!ord.invoiceId}
                      title={!ord.invoiceId ? 'Waiting for Store Admin to assign an Invoice Number' : undefined}
                      onClick={() => handleMarkDone(ord)}
                    >
                      {ord.invoiceId ? 'Done' : 'Awaiting Invoice'}
                    </button>
                  </>
                )}
                {tab !== 'active' && (
                  <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate(`/production/orders/${ord.id}`)}>
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
