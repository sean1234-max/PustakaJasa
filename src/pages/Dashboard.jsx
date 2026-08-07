import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';

export default function Dashboard() {
  const { state, openAmend, openAddOn, reorderOrder } = useAppState();
  const navigate = useNavigate();

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

      <div className="card-kicker">My Orders</div>
      <div className="order-grid">
        {state.orders.map((ord) => {
          const idx = STATUS_STAGES.indexOf(ord.status);
          const invoiceIdLabel = idx >= 2 ? (ord.invoiceId || `INV-${ord.id.replace('ORD-', '')}`) : '-';
          const canAmend = idx < 2;
          const canAddOn = idx === 2;
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
