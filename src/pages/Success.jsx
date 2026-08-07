import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';

export default function Success() {
  const { state } = useAppState();
  const navigate = useNavigate();

  return (
    <div className="screen-center" style={{ maxWidth: 440 }}>
      <div className="card elev-md" style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="success-check">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent-700)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Order Submitted</div>
        <p className="hint-text" style={{ margin: '0 0 var(--space-2)' }}>
          Order <strong>{state.lastOrderId}</strong> has been sent to Sales for review.
        </p>
        <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>
          You'll see the status update in My Orders as it moves through approval, production, and delivery.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/dashboard')}>Go to My Orders</button>
          <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>Place Another Order</button>
        </div>
      </div>
    </div>
  );
}
