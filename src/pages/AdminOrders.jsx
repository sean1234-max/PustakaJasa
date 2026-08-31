import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { ORDER_STATUSES, statusPillStyle } from '../data/catalog';

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

function Select({ label, value, onChange, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-label-bold text-on-surface-variant">{label}</label>
      <div className="relative">
        <select
          className="w-full appearance-none bg-transparent border border-outline-variant text-on-surface text-body-md rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary cursor-pointer pr-10"
          value={value}
          onChange={onChange}
        >
          {children}
        </select>
        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none">expand_more</span>
      </div>
    </div>
  );
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
    <AdminLayout title="Orders" subtitle="Every order across every school.">
      <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm mb-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
          <Select label="School" value={schoolFilter} onChange={(e) => setSchoolFilter(e.target.value)}>
            <option value="all">All Schools</option>
            {schoolOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select label="Salesman" value={salesmanFilter} onChange={(e) => setSalesmanFilter(e.target.value)}>
            <option value="all">All Salesmen</option>
            {salesmanOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Select label="Date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            {DATE_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </div>

        {dateFilter === 'Custom Range' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
            <div className="flex flex-col gap-2">
              <label className="text-label-bold text-on-surface-variant" htmlFor="date-from">From</label>
              <input className="border border-outline-variant text-on-surface text-body-md rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" id="date-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-label-bold text-on-surface-variant" htmlFor="date-to">To</label>
              <input className="border border-outline-variant text-on-surface text-body-md rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary" id="date-to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <span className="text-body-sm text-on-surface-variant">{filtered.length} of {orders.length} orders</span>
          <button type="button" onClick={clearFilters} className="text-label-bold font-semibold text-on-surface hover:text-primary transition-colors py-2 px-4 rounded-lg hover:bg-surface-variant">
            Clear Filters
          </button>
        </div>
      </section>

      {filtered.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No orders found. Try changing the school, salesman, status, or date filter.</p>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((ord) => {
            return (
              <button
                type="button"
                key={ord.id}
                onClick={() => navigate(`/admin/orders/${ord.id}`)}
                className="text-left bg-surface-container-lowest border border-outline-variant rounded-xl p-5 shadow-sm hover:shadow-lg transition-all duration-200"
              >
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <span className="block text-label-bold uppercase tracking-wider text-on-surface-variant mb-1">Order ID</span>
                    <span className="text-headline-sm text-primary">{ord.id}</span>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap" style={statusPillStyle(ord.status)}>
                    {ord.status}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <span className="block text-body-sm text-on-surface-variant mb-0.5">Sekolah</span>
                    <span className="block text-body-md text-on-surface font-medium truncate">{ord.sekolah || '—'}</span>
                  </div>
                  <div>
                    <span className="block text-body-sm text-on-surface-variant mb-0.5">Sales</span>
                    <span className="block text-body-md text-on-surface font-medium truncate">{ord.sales || '—'}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="block text-body-sm text-on-surface-variant mb-0.5">Date Placed</span>
                    <span className="block text-body-md text-on-surface font-medium">{ord.datePlaced}</span>
                  </div>
                  <div>
                    <span className="block text-body-sm text-on-surface-variant mb-0.5">Invoice Number</span>
                    <span className="block text-body-md text-on-surface font-medium truncate">{ord.invoiceId || '—'}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </section>
      )}
    </AdminLayout>
  );
}
