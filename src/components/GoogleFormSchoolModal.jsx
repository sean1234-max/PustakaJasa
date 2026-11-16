// After a salesman approves an order or an add-on (Sean, 2026-11-10): the Google Form's school name is
// "<school> (W) - <his words>". The part up to "-" is fixed; he types the rest, then SUBMIT fills the form
// (fill-google-form). It can't be closed before SUBMIT — the form is only filled from here.
// A look-alike row already in the MASTER LIST asks before filling it again (Sean, 2026-11-16): YES fills it
// anyway, NO leaves it.
// Same look as ShipmentConfirmModal (the browser's own modal <dialog>).
import { useEffect, useRef, useState } from 'react';
import { fillGoogleForm, googleFormNote } from '../lib/googleFormApi';

const MAX_NOTE = 60;

export default function GoogleFormSchoolModal({ orderId, school, onDone }) {
  const ref = useRef(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  useEffect(() => {
    const d = ref.current;
    if (d && orderId && !d.open) d.showModal();
  }, [orderId]);
  if (!orderId) return null;

  const prefix = `${school} (W) -`;
  const submit = async (force = false) => {
    setBusy(true);
    setRes(await fillGoogleForm(orderId, note.trim(), force));
    setBusy(false);
  };
  const close = () => { ref.current?.close(); onDone(); };
  const byHand = res && ['failed', 'error', 'no_sale'].includes(res.status);
  const lookAlike = res?.status === 'duplicate' && !res.declined;
  const dup = res?.duplicate;

  return (
    <dialog ref={ref} className="crystal-confirm" aria-labelledby="googleFormTitle" onCancel={(e) => e.preventDefault()}>
      <div id="googleFormTitle" className="crystal-confirm-title">GOOGLE FORM — SCHOOL NAME</div>
      {!res ? (
        <>
          <p className="crystal-confirm-text">Type what comes after the school name ({orderId}).</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 var(--space-4)' }}>
            <strong style={{ whiteSpace: 'nowrap' }}>{prefix}</strong>
            <input
              className="input" autoFocus value={note} maxLength={MAX_NOTE} disabled={busy}
              placeholder="e.g. kokurikulum" onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
          <div className="crystal-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit()}>{busy ? 'Submitting…' : 'SUBMIT'}</button>
          </div>
        </>
      ) : lookAlike ? (
        <>
          <p className="crystal-confirm-text">
            📝 The Google Form already has a row like this{dup ? ` (row ${dup.row}: ${dup.school}, QTY ${dup.qty})` : ''}.
            <br />Fill it again?
          </p>
          <div className="crystal-confirm-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => submit(true)}>{busy ? 'Submitting…' : 'YES, FILL AGAIN'}</button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRes({ ...res, declined: true })}>NO</button>
          </div>
        </>
      ) : (
        <>
          <p className="crystal-confirm-text" style={{ color: byHand ? '#c0392b' : undefined }}>
            {googleFormNote(res) || '📝 Done.'}
            {byHand && res.formUrl && <><br /><a href={res.formUrl} target="_blank" rel="noopener noreferrer">Open the Google Form</a></>}
          </p>
          <div className="crystal-confirm-actions">
            <button type="button" className="btn btn-primary" onClick={close}>OK</button>
          </div>
        </>
      )}
    </dialog>
  );
}
