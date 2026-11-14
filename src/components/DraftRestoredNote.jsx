import { useNavigate } from 'react-router-dom';
import { useAppState } from '../state/useAppState';
import ConfirmButton from './ConfirmButton';

// The New Order came back from this browser after a refresh (draftPersistence.js): say so, and offer a
// clean start. `resume` (Dashboard): a button back into the order as well.
export default function DraftRestoredNote({ resume = false }) {
  const { state, patch, startNewOrder } = useAppState();
  const navigate = useNavigate();
  if (!state.draftRestoredToast) return null;
  return (
    <div className="update-toast" role="status" style={{ flexWrap: 'wrap' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      {state.draftRestoredToast}
      {resume && <button type="button" className="btn btn-ghost" onClick={() => navigate('/order/step1')}>Resume</button>}
      <ConfirmButton
        label="Clear and start over"
        question="Clear this whole order (Function Details, Order Details and cart)?"
        confirmLabel="Yes, clear it"
        className="btn btn-ghost"
        onConfirm={() => { startNewOrder(); navigate('/order/step1'); }}
      />
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Dismiss" style={{ marginLeft: 'auto' }} onClick={() => patch({ draftRestoredToast: '' })}>✕</button>
    </div>
  );
}
