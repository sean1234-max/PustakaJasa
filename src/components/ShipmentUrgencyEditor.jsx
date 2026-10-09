import { useState } from 'react';
import DatePicker from './DatePicker';
import ConfirmButton from './ConfirmButton';
import { useAppState } from '../state/useAppState';
import { formatDate, toMalaysiaDay, malaysiaToday } from '../data/catalog';
import { isUrgentShipment, SHIPMENT_EDITABLE_STATUSES } from '../utils/urgentOrder';

// Production: fix a Shipment Date the salesman got wrong, and/or the Urgent
// flag (Sean, 2026-10-09). Urgent never changes by itself when the date does
// — the hint only says what the new date would count as.
export default function ShipmentUrgencyEditor({ order }) {
  const { today, updateShipmentAndUrgency } = useAppState();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(() => toMalaysiaDay(order.shipmentDate));
  const [urgent, setUrgent] = useState(!!order.urgent);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  if (!SHIPMENT_EDITABLE_STATUSES.includes(order.status)) return null;

  const start = () => {
    setDate(toMalaysiaDay(order.shipmentDate));
    setUrgent(!!order.urgent);
    setMessage(null);
    setOpen(true);
  };
  const save = async () => {
    setSaving(true);
    const res = await updateShipmentAndUrgency(order.id, date, urgent);
    setSaving(false);
    if (!res.ok) { setMessage({ ok: false, text: res.message }); return; }
    if (res.sheetError) { setMessage({ ok: false, text: res.sheetError, retry: true }); return; }
    setMessage({
      ok: true,
      text: res.sheet === 'remove' ? 'Saved — removed from the urgent Google Sheet.'
        : res.sheet === 'sync' ? 'Saved — urgent Google Sheet updated.' : 'Saved.',
    });
    setOpen(false);
  };

  // Urgent counts from the approval day, which isn't stored — so the hint
  // only runs before approval ("if approved today"); afterwards it's left
  // to Production.
  const showHint = order.status === 'Reviewing Order' && !!date;
  const dateUrgent = showHint && isUrgentShipment(malaysiaToday(), date);
  const unchanged = date && order.shipmentDate
    && formatDate(date) === formatDate(toMalaysiaDay(order.shipmentDate)) && urgent === !!order.urgent;

  return (
    <div className="card" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)' }}>
      <div className="dim">Shipment Date / Urgent</div>
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 4 }}>
          <span>{order.shipmentDate ? formatDate(toMalaysiaDay(order.shipmentDate)) : '—'}{order.urgent ? ' · URGENT' : ' · Normal'}</span>
          <button type="button" className="btn btn-secondary" onClick={start}>Change</button>
        </div>
      ) : (
        <>
          <div className="form-grid-2" style={{ marginTop: 'var(--space-2)' }}>
            <DatePicker label="Shipment Date" id={`ship-${order.id}`} selected={date} onSelect={setDate} today={today} />
            <div className="field">
              <label htmlFor={`urgent-${order.id}`}>Urgent</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input id={`urgent-${order.id}`} type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
                {urgent ? 'Urgent' : 'Normal (not urgent)'}
              </label>
            </div>
          </div>
          {showHint && dateUrgent !== urgent && (
            <p className="urgent-hint">If approved today, this date would count as {dateUrgent ? 'urgent' : 'not urgent'} — tick or untick Urgent yourself if needed.</p>
          )}
          {order.urgentSheetSyncedAt && !urgent && (
            <p className="hint-text">This order will be removed from the urgent Google Sheet.</p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
            <ConfirmButton
              label={saving ? 'Saving…' : 'Save'}
              question={`Change ${order.id} to ${date ? formatDate(date) : '—'}, ${urgent ? 'Urgent' : 'Normal'}?`}
              confirmLabel="Yes, save"
              disabled={saving || !date || unchanged}
              onConfirm={save}
            />
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </>
      )}
      {message && (
        <p className="hint-text" style={{ marginTop: 'var(--space-2)', color: message.ok ? '#1f8a3b' : '#c0392b', fontWeight: 600 }}>
          {message.text}{' '}
          {message.retry && (
            <button type="button" className="btn btn-ghost" disabled={saving} onClick={save}>Retry Sheet</button>
          )}
        </p>
      )}
    </div>
  );
}
