import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT, formatDate } from '../data/catalog';

// Production only ever works orders that are already 'In Production' —
// split into two local tabs by whether the invoice ID (handed over on
// paper by billing) has been recorded yet. Not STATUS_STAGES-driven since
// this is a sub-split of a single stage, not a stage of its own. Order
// History is everything Production has already marked Done (see
// markProductionDone in src/state/AppState.jsx) — read-only, so it can go
// straight off `status` without the invoice split the active stages need.
const TABS = [
  { key: 'pending', label: 'Pending Invoice', match: (o) => o.status === 'In Production' && !o.invoiceId },
  { key: 'ready', label: 'Ready for Export', match: (o) => o.status === 'In Production' && !!o.invoiceId },
  { key: 'history', label: 'Order History', match: (o) => o.status === 'Waiting for Delivery' || o.status === 'Completed' },
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
  const { state, markProductionDone } = useAppState();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  // Lets Production see, at a glance, everything due out on one delivery
  // date — useful across all three tabs (what's coming up in Pending
  // Invoice, what's ready to ship today, what already went out).
  const [dueDateFilter, setDueDateFilter] = useState('');

  const handleMarkDone = (ord) => {
    if (!window.confirm(`Mark order ${ord.id} as done? Its status will change to "Waiting for Delivery".`)) return;
    markProductionDone(ord.id);
  };

  const activeTab = TABS.find((t) => t.key === tab);
  const ordersInTab = state.orders.filter(activeTab.match);
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
          <p className="hint-text" style={{ margin: 0 }}>Record the invoice ID once billing hands over the printed order, then export each category's CSV for the AI file.</p>
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
          const count = state.orders.filter(t.match).length;
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
        <label htmlFor="dueDateFilter">Filter by Due Date (delivery)</label>
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
          const idx = STATUS_STAGES.indexOf(ord.status);

          return (
            <div key={ord.id} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
              </div>

              <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
              </div>
              <div className="order-card-meta">
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                <div><div className="dim">Due Date</div><div>{ord.dueDate ? formatDate(new Date(ord.dueDate)) : '—'}</div></div>
                <div><div className="dim">Total QTY</div><div>{(ord.items || []).reduce((sum, it) => sum + (Number(it.qty) || 0), 0)}</div></div>
              </div>

              <div className="order-card-invoice"><span className="dim">Invoice ID:</span> {ord.invoiceId || '—'}</div>
              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              <div className="order-card-actions" style={tab === 'ready' ? { display: 'flex', gap: 'var(--space-2)' } : undefined}>
                {tab === 'pending' && (
                  <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(`/production/orders/${ord.id}`)}>
                    Enter Invoice ID
                  </button>
                )}
                {tab === 'ready' && (
                  <>
                    <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => navigate(`/production/orders/${ord.id}`)}>
                      View Order
                    </button>
                    <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleMarkDone(ord)}>
                      Done
                    </button>
                  </>
                )}
                {tab === 'history' && (
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
