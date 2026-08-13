import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

const DATE_OPTIONS = ['All Time', 'Today', 'This Week', 'This Month', 'Custom Range'];

// order.datePlaced is a display string like "13 Aug 2026" (see formatDate
// in src/data/catalog.js), not an ISO date — parsed here for range
// comparisons only. Invalid/unparsable dates are simply excluded from any
// specific date filter rather than throwing.
function parseDatePlaced(str) {
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export default function AdminOrders() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [schoolFilter, setSchoolFilter] = useState('all');
  const [salesmanFilter, setSalesmanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('All Time');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const orders = state.orders || [];
  const schoolOptions = useMemo(() => [...new Set(orders.map((o) => o.sekolah).filter(Boolean))].sort(), [orders]);
  const salesmanOptions = useMemo(() => [...new Set(orders.map((o) => o.sales).filter(Boolean))].sort(), [orders]);
  // (orders is a fresh `[]` fallback whenever state.orders is falsy, so this
  // memoization is best-effort — the derived lists are cheap enough that
  // recomputing them on unrelated re-renders isn't worth chasing further.)

  const inDateRange = (order) => {
    if (dateFilter === 'All Time') return true;
    const placed = parseDatePlaced(order.datePlaced);
    if (!placed) return false;
    const today = startOfDay(new Date());

    if (dateFilter === 'Today') return startOfDay(placed).getTime() === today.getTime();
    if (dateFilter === 'This Week') {
      const weekStart = new Date(today);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      return placed >= weekStart;
    }
    if (dateFilter === 'This Month') {
      return placed.getFullYear() === today.getFullYear() && placed.getMonth() === today.getMonth();
    }
    if (dateFilter === 'Custom Range') {
      if (customFrom && placed < startOfDay(new Date(customFrom))) return false;
      if (customTo && placed > new Date(new Date(customTo).setHours(23, 59, 59, 999))) return false;
      return true;
    }
    return true;
  };

  const filtered = orders.filter((o) => {
    if (schoolFilter !== 'all' && o.sekolah !== schoolFilter) return false;
    if (salesmanFilter !== 'all' && o.sales !== salesmanFilter) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (!inDateRange(o)) return false;
    return true;
  });

  const clearFilters = () => {
    setSchoolFilter('all'); setSalesmanFilter('all'); setStatusFilter('all');
    setDateFilter('All Time'); setCustomFrom(''); setCustomTo('');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Orders</div>
          <p className="hint-text" style={{ margin: 0 }}>Every order across every school.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="form-grid-2" style={{ gridTemplateColumns: dateFilter === 'Custom Range' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr 1fr' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-school">School</label>
            <select className="input" id="filter-school" value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}>
              <option value="all">All Schools</option>
              {schoolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-salesman">Salesman</label>
            <select className="input" id="filter-salesman" value={salesmanFilter} onChange={(e) => setSalesmanFilter(e.target.value)}>
              <option value="all">All Salesmen</option>
              {salesmanOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-status">Status</label>
            <select className="input" id="filter-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              {STATUS_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="filter-date">Date</label>
            <select className="input" id="filter-date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
              {DATE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {dateFilter === 'Custom Range' && (
          <div className="form-grid-2" style={{ marginTop: 'var(--space-4)' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="date-from">From</label>
              <input className="input" id="date-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="date-to">To</label>
              <input className="input" id="date-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="row-split" style={{ marginTop: 'var(--space-4)' }}>
          <span className="hint-text" style={{ margin: 0 }}>{filtered.length} of {orders.length} orders</span>
          <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear Filters</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="hint-text">No orders found. Try changing the school, salesman, status, or date filter.</p>
      ) : (
        <div className="order-grid">
          {filtered.map((ord) => {
            const idx = STATUS_STAGES.indexOf(ord.status);
            return (
              <div key={ord.id} className="card order-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${ord.id}`)}>
                <div className="order-card-top">
                  <div>
                    <div className="order-card-label">Order ID</div>
                    <div className="order-card-id">{ord.id}</div>
                  </div>
                  <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
                </div>
                <div className="order-card-meta">
                  <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
                  <div><div className="dim">Sales</div><div>{ord.sales || '—'}</div></div>
                </div>
                <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                  <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
