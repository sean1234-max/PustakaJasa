import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

const FILTERS = [
  { key: 'Submitted to Sales', label: 'Submitted to Sales', match: (o) => o.status === 'Submitted to Sales' },
  { key: 'In Production', label: 'In Production', match: (o) => o.status === 'In Production' },
  { key: 'Waiting for Delivery', label: 'Waiting for Delivery', match: (o) => o.status === 'Waiting for Delivery' },
  { key: 'Delivered', label: 'Delivered', match: (o) => o.status === 'Completed' },
];

export default function Dashboard() {
  const { state, openAmend, openAddOn, reorderOrder, cancelPendingAddOn } = useAppState();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('Submitted to Sales');
  const [expandedAddOnId, setExpandedAddOnId] = useState(null);

  const activeFilter = FILTERS.find((f) => f.key === filter) || FILTERS[0];
  const filteredOrders = state.orders.filter(activeFilter.match);

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Selamat Kembali, Cikgu</div>
          <p className="hint-text" style={{ margin: 0 }}>Review your award orders and track them through approval, production, and delivery.</p>
        </div>
        <button type="button" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => navigate('/order/step1')}>+ New Order</button>
      </div>

      {state.updateToast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {state.updateToast}
        </div>
      )}
      {state.draftRestoredToast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {state.draftRestoredToast} <button type="button" className="btn btn-ghost" style={{ marginLeft: 'var(--space-2)' }} onClick={() => navigate('/order/step1')}>Resume</button>
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 'var(--space-4)' }}>
        {FILTERS.map((f) => {
          const count = state.orders.filter(f.match).length;
          return (
            <button
              key={f.key}
              type="button"
              className={`btn ${f.key === filter ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="card-kicker">{activeFilter.label}</div>
      {filteredOrders.length === 0 && (
        <p className="hint-text" style={{ marginTop: 'var(--space-4)' }}>No orders in this stage.</p>
      )}
      <div className="order-grid">
        {filteredOrders.map((ord) => {
          const idx = STATUS_STAGES.indexOf(ord.status);
          const invoiceIdLabel = idx >= 1 ? (ord.invoiceId || `INV-${ord.id.replace('ORD-', '')}`) : '-';
          const canAmend = idx === 0;
          const canAddOn = idx === 1 && ord.pendingAddonStatus !== 'pending';
          const isCompleted = ord.status === 'Completed';

          return (
            <div key={ord.id} className="card order-card">
              <div className="order-card-top">
                <div>
                  <div className="order-card-label">Order ID</div>
                  <div className="order-card-id">{ord.id}</div>
                </div>
                <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
              </div>

              <div className="order-dots">
                {STATUS_STAGES.map((_, i2) => (
                  <div key={i2} className="order-dot" style={{ background: i2 <= idx ? 'var(--color-accent-700)' : 'var(--color-neutral-300)' }} />
                ))}
              </div>

              <div className="order-card-meta">
                <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                <div><div className="dim">Est. Delivery</div><div>{ord.deliveryDate}</div></div>
              </div>
              <div className="order-card-invoice"><span className="dim">Invoice ID:</span> {invoiceIdLabel}</div>
              <div className="dim" style={{ fontSize: 11 }}>Total Amount</div>
              <div className={`order-card-total${ord.priceAdjusted ? ' amount-adjusted' : ''}`}>RM {ord.totalAmount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>

              {ord.pendingAddonStatus === 'pending' && (
                <div style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)', fontSize: 12, padding: 'var(--space-2) var(--space-3)', marginTop: 'var(--space-2)' }}>
                  Add-on submitted — waiting for Sales approval.
                  <button type="button" className="btn btn-ghost" style={{ marginLeft: 'var(--space-2)', padding: 0 }} onClick={() => setExpandedAddOnId(expandedAddOnId === ord.id ? null : ord.id)}>
                    {expandedAddOnId === ord.id ? 'Hide' : 'View Add-On'}
                  </button>
                  <button type="button" className="btn btn-ghost" style={{ marginLeft: 'var(--space-2)', padding: 0 }} onClick={() => cancelPendingAddOn(ord.id)}>Cancel</button>
                  {expandedAddOnId === ord.id && (
                    <table className="table" style={{ margin: 'var(--space-2) 0 0', background: '#fff' }}>
                      <thead><tr><th>Category</th><th>Jenis Plak</th><th style={{ width: 80 }}>QTY</th><th style={{ width: 100 }}>Harga</th></tr></thead>
                      <tbody>
                        {(ord.pendingAddonItems || []).map((it) => (
                          <tr key={it.id}>
                            <td>{it.categoryLabel}</td>
                            <td>{it.jenisPlak}</td>
                            <td>{it.qty}</td>
                            <td>RM {it.harga.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {ord.pendingAddonStatus === 'rejected' && (
                <div className="login-error" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
                  Add-on rejected by Sales{ord.pendingAddonRejectReason ? `: ${ord.pendingAddonRejectReason}` : '.'}
                  <button type="button" className="btn btn-ghost" style={{ marginLeft: 'var(--space-2)', padding: 0 }} onClick={() => cancelPendingAddOn(ord.id)}>Dismiss</button>
                </div>
              )}

              <div className="order-card-actions">
                <button type="button" className="btn btn-ghost btn-block" onClick={() => navigate(`/orders/${ord.id}`)}>View Details</button>
                {canAmend && <button type="button" className="btn btn-secondary btn-block" onClick={() => { openAmend(ord); navigate(`/amend/${ord.id}`); }}>Update Details</button>}
                {canAddOn && <button type="button" className="btn btn-secondary btn-block" onClick={() => { openAddOn(ord); navigate(`/addon/${ord.id}`); }}>Add On</button>}
                {isCompleted && <button type="button" className="btn btn-secondary btn-block" onClick={() => { reorderOrder(ord); navigate('/order/step1'); }}>Reorder</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
