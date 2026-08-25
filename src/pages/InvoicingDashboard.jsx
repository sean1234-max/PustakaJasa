import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';
import { getOrderChangeStamp } from '../utils/orderStamp';

// Invoicing Department can now see and act on every order, including ones
// still 'Submitted to Sales' — a Salesman sometimes hands over a paper
// hard copy before ever clicking Approve in the system, and opening one
// of those here lets Invoicing approve it (with pricing) and save its
// Invoice Number in one action (see InvoicingOrderDetail.jsx's
// approveAndSetInvoiceId, supabase/migrations/0038_invoicing_can_approve.sql).
// Split by whether an Invoice Number has been assigned yet — the exact
// responsibility Production used to own (see ProductionOrderDetail.jsx's
// history before this change) and no longer does.
const TABS = [
  { key: 'pending', label: 'Waiting for Invoice', match: (o) => !o.invoiceId },
  { key: 'invoiced', label: 'Invoiced', match: (o) => !!o.invoiceId },
];

export default function InvoicingDashboard() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [tab, setTab] = useState(TABS[0].key);
  const [search, setSearch] = useState('');
  const [salesmanFilter, setSalesmanFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');

  const orders = state.orders || [];
  const salesmanOptions = useMemo(() => [...new Set(orders.map((o) => o.sales).filter(Boolean))].sort(), [orders]);
  const statusOptions = STATUS_STAGES;

  const activeTab = TABS.find((t) => t.key === tab);
  const ordersInTab = orders.filter(activeTab.match);

  const filteredOrders = ordersInTab.filter((o) => {
    const q = search.trim().toLowerCase();
    if (q && !o.id.toLowerCase().includes(q) && !(o.invoiceId || '').toLowerCase().includes(q)) return false;
    if (salesmanFilter !== 'all' && o.sales !== salesmanFilter) return false;
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    const isTambahan = !!getOrderChangeStamp(o);
    if (typeFilter === 'original' && isTambahan) return false;
    if (typeFilter === 'tambahan' && !isTambahan) return false;
    return true;
  });

  const clearFilters = () => {
    setSearch(''); setSalesmanFilter('all'); setStatusFilter('all'); setTypeFilter('all');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Invoicing</div>
          <p className="hint-text" style={{ margin: 0 }}>Assign Invoice Numbers for approved orders — or approve one yourself (with pricing) straight from a hard copy — and search/track ones already invoiced.</p>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {TABS.map((t) => {
          const count = orders.filter(t.match).length;
          return (
            <button
              key={t.key}
              type="button"
              className={`btn ${t.key === tab ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(t.key)}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card-kicker">Search &amp; Filter</div>
      <div className="form-grid-2" style={{ margin: 'var(--space-3) 0 var(--space-4)' }}>
        <div className="field">
          <label htmlFor="invoiceSearch">Order ID or Invoice Number</label>
          <input className="input" id="invoiceSearch" placeholder="e.g. ORD-2026-097 or INV-2026-090" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="salesmanFilter">Salesman</label>
          <select className="input" id="salesmanFilter" value={salesmanFilter} onChange={(e) => setSalesmanFilter(e.target.value)}>
            <option value="all">All Salesmen</option>
            {salesmanOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="statusFilter">Status</label>
          <select className="input" id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {statusOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="typeFilter">Original / Tambahan</label>
          <select className="input" id="typeFilter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All Orders</option>
            <option value="original">Original Only (no Tambahan)</option>
            <option value="tambahan">Has Tambahan</option>
          </select>
        </div>
      </div>
      <div className="row-split" style={{ marginBottom: 'var(--space-4)' }}>
        <span className="hint-text">{filteredOrders.length} of {ordersInTab.length} orders</span>
        <button type="button" className="btn btn-ghost" onClick={clearFilters}>Clear Filters</button>
      </div>

      {filteredOrders.length === 0 && <p className="hint-text">No orders match.</p>}
      <div className="order-grid">
        {filteredOrders.map((ord) => {
          const idx = STATUS_STAGES.indexOf(ord.status);
          const stamp = getOrderChangeStamp(ord);
          return (
            <div key={ord.id} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
              </div>
              {stamp && <div className="order-stamp-inline" style={{ marginTop: 'var(--space-1)' }}>{stamp}</div>}

              <div className="order-card-meta">
                <div><div className="dim">Sekolah</div><div>{ord.sekolah || '—'}</div></div>
                <div><div className="dim">Salesman</div><div>{ord.sales || '—'}</div></div>
                <div><div className="dim">Order Date</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Order Type</div><div>{stamp ? 'Original + Tambahan' : 'Original'}</div></div>
              </div>

              <div className="order-card-invoice"><span className="dim">Invoice Number:</span> {ord.invoiceId || '—'}</div>
              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              <div className="order-card-actions">
                <button type="button" className="btn btn-primary btn-block" onClick={() => navigate(`/invoicing/orders/${ord.id}`)}>
                  {ord.invoiceId ? 'View Order' : ord.status === 'Submitted to Sales' ? 'Approve & Invoice' : 'Assign Invoice'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
