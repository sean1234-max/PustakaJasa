import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '../state/useAppState';
import { fetchPendingChanges, markBotRequest } from '../lib/botRequestsApi';
import { applyPlan, dayOf } from '../utils/botRequests';
import { formatDate, malaysiaToday } from '../data/catalog';
import { isUrgentShipment } from '../utils/urgentOrder';

// Telegram change requests waiting on this order (supabase/functions/telegram-bot): what the salesman
// asked, Apply (through the website's own Shipment editor path and order details) or Dismiss.
const LABEL = { shipmentDate: 'Shipment Date', functionDate: 'Function Date', remark: 'Remark' };
const shown = (field, value) => (field === 'remark' ? value || '—' : formatDate(dayOf(value)) || '—');

function ChangeRequest({ request, order, onDone }) {
  const { updateShipmentAndUrgency, updateOrderDetails } = useAppState();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const plan = applyPlan(request.changes);
  const becomesUrgent = plan.shipmentDate && !order.urgent && isUrgentShipment(order.invoiceSetAt || malaysiaToday(), plan.shipmentDate);

  const apply = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (plan.shipmentDate) {
        const res = await updateShipmentAndUrgency(order.id, plan.shipmentDate, !!order.urgent);
        if (!res.ok) { setMessage(res.message); return; }
      }
      if (Object.keys(plan.details).length) {
        const res = await updateOrderDetails(order.id, plan.details);
        if (!res.ok) { setMessage(res.message); return; }
      }
      await markBotRequest(request.id, 'applied');
      onDone();
    } catch (err) {
      console.error('Applying the Telegram change failed:', err);
      setMessage('Could not apply it — please try again.');
    } finally {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    setBusy(true);
    try { await markBotRequest(request.id, 'dismissed'); onDone(); } catch (err) {
      console.error('Dismissing the Telegram change failed:', err);
      setMessage('Could not dismiss it — please try again.');
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 'var(--space-3)', border: '1px solid #8fb3e0', borderRadius: 6, background: '#eef5fd', marginBottom: 'var(--space-3)' }}>
      <div style={{ fontWeight: 700 }}>📩 Change request from Telegram{request.requested_by ? ` (${request.requested_by})` : ''}</div>
      {request.changes.map((c) => (
        <div key={c.field} style={{ marginTop: 4 }}>
          {LABEL[c.field]}: <span className="dim" style={{ textDecoration: 'line-through' }}>{shown(c.field, c.from)}</span> → <strong style={{ whiteSpace: 'pre-line' }}>{shown(c.field, c.to)}</strong>
        </div>
      ))}
      {becomesUrgent && <p className="hint-text" style={{ margin: '4px 0 0', color: '#b45309' }}>The new Shipment Date would count as URGENT — Urgent isn’t changed by itself; change it in Shipment Date / Urgent if needed.</p>}
      {request.source_text && (
        <details style={{ marginTop: 4 }}>
          <summary className="dim" style={{ cursor: 'pointer', fontSize: 13 }}>The message</summary>
          <div className="dim" style={{ fontSize: 13, whiteSpace: 'pre-line' }}>{request.source_text}</div>
        </details>
      )}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={apply}>Apply</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={dismiss}>Dismiss</button>
      </div>
      {message && <p className="hint-text" style={{ margin: '4px 0 0', color: '#b0392e', fontWeight: 600 }}>{message}</p>}
    </div>
  );
}

export default function BotChangeRequests({ order }) {
  const [requests, setRequests] = useState([]);
  const load = useCallback(() => {
    fetchPendingChanges(order.id).then(setRequests).catch((err) => console.error('Could not load Telegram change requests:', err));
  }, [order.id]);
  useEffect(() => { load(); }, [load]);
  if (!requests.length) return null;
  return requests.map((r) => <ChangeRequest key={r.id} request={r} order={order} onDone={load} />);
}
