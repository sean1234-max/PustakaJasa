import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';
import { googleFormNote } from '../lib/googleFormApi';

export default function Success() {
  const { state, startNewOrder } = useAppState();
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
          Order <strong>{state.lastOrderId}</strong> has been received. Production will check it first, then your salesman approves it.
        </p>
        <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>
          You'll see the status update in My Orders as it moves through approval, production, and delivery.
        </p>
        {state.role === 'salesman' && <GoogleFormLine res={state.lastGoogleForm?.orderId === state.lastOrderId ? state.lastGoogleForm : null} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate(state.role === 'salesman' ? '/sales/dashboard' : '/dashboard')}>Go to My Orders</button>
          <button type="button" className="btn btn-ghost" onClick={() => { startNewOrder(); navigate('/order/step1'); }}>Place Another Order</button>
        </div>
      </div>
    </div>
  );
}

// The salesman's Google Form, filled after Submit (fill-google-form): how it went, and what to type when it
// has to be filled by hand
function GoogleFormLine({ res }) {
  if (!res) return <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>📝 Filling the Google Form…</p>;
  const note = googleFormNote(res);
  if (!note) return null;
  const byHand = res.status === 'failed' || res.status === 'error' || res.status === 'no_sale';
  const v = res.values;
  return (
    <div className="hint-text" style={{ margin: '0 0 var(--space-6)', fontWeight: 600, color: byHand ? '#c0392b' : undefined }}>
      <div>{note}</div>
      {byHand && res.formUrl && <a href={res.formUrl} target="_blank" rel="noopener noreferrer">Open the Google Form</a>}
      {byHand && v && (
        <pre style={{ textAlign: 'left', whiteSpace: 'pre-wrap', fontWeight: 400, margin: '6px 0 0' }}>
          {`ORDER DATE ${v.orderDate}\nDUE DATE ${v.dueDate || '—'}\nFUNC. DATE ${v.funcDate || '—'}\nSALE ${v.sale || '—'}\nSCHOOL ${v.school}\nREMARK ${v.remark}\nQTY ${v.qty}`}
        </pre>
      )}
    </div>
  );
}
