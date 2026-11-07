import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Nav from '../components/Nav';
import DatePicker from '../components/DatePicker';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { formatDate, addDays, toMalaysiaDay } from '../data/catalog';
import { uploadLogo } from '../lib/storageApi';
import { searchSchools, fetchOrderDraft, downloadDraftFile } from '../lib/ordersApi';

const SCHOOL_SEARCH_DELAY_MS = 250;

// Salesman New Order: the school must be one already in the system, picked
// from what matches the typed text (search_schools, 0081).
function SchoolSearch({ value, picked, onPick }) {
  const [text, setText] = useState(value);
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const q = text.trim();
    if (!open || !q) { setMatches([]); return undefined; }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchSchools(q)
        .then((rows) => { if (!cancelled) { setMatches(rows); setError(''); } })
        .catch((err) => {
          console.error('School search failed:', err);
          if (!cancelled) setError('Could not search schools. Check your connection and try again.');
        });
    }, SCHOOL_SEARCH_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, open]);

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="input" id="sekolah" placeholder="Type to search, e.g. SK Sungai" autoComplete="off"
        value={text}
        onChange={(e) => { setText(e.target.value); setOpen(true); if (picked) onPick(null); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && text.trim() && (
        <div className="card elev-md" style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, marginTop: 4, padding: 0, maxHeight: 260, overflowY: 'auto' }}>
          {error && <p className="hint-text" style={{ margin: 'var(--space-2) var(--space-3)', color: '#b3261e' }}>{error}</p>}
          {!error && matches.length === 0 && <p className="hint-text" style={{ margin: 'var(--space-2) var(--space-3)' }}>No school found.</p>}
          {matches.map((m) => (
            <button
              key={m.id} type="button" className="btn btn-ghost"
              style={{ display: 'block', width: '100%', textAlign: 'left', borderRadius: 0 }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setText(m.sekolah); setOpen(false); onPick(m); }}
            >
              {m.sekolah}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewOrderStep1() {
  const { state, patch, today, refreshAssignedSalesman, pickActingSchool, startNewOrder } = useAppState();
  const isSalesman = state.role === 'salesman';
  // Salesman Edit Order (openEditOrder): this submitted order's details; school and salesman stay as they are
  const editing = !!state.editOrderId;
  const editOrder = editing ? state.orders.find((o) => o.id === state.editOrderId) : null;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft');
  const draftLoaded = useRef(null);

  // A draft the form bot kept (?draft=<id>, migration 0114): a fresh New Order with its Function
  // Details, the school when the name matches exactly one, and its FORM ANUGERAH waiting for Step 2.
  useEffect(() => {
    if (!draftId || draftLoaded.current === draftId) return;
    draftLoaded.current = draftId;
    (async () => {
      try {
        const draft = await fetchOrderDraft(draftId);
        if (!draft) { patch({ stepError: 'That order link is not yours, or it no longer exists.' }); return; }
        startNewOrder();
        const f = draft.fields || {};
        const day = (iso) => (iso ? toMalaysiaDay(`${iso}T00:00:00+08:00`) : null);
        patch({
          picName: f.picName || '', phone: f.phone || '', ketuaPanitia: f.ketuaPanitia || '', terms: f.terms || '',
          funcSelected: day(f.functionDate), shipmentDateSelected: day(f.shipmentDate),
          pendingDraftFile: draft.file_path ? await downloadDraftFile(draft.file_path, draft.file_name) : null,
        });
        const name = String(f.sekolah || '').trim();
        const matches = name ? await searchSchools(name) : [];
        const school = matches.find((m) => m.sekolah.toUpperCase() === name.toUpperCase()) || (matches.length === 1 ? matches[0] : null);
        if (school) pickActingSchool(school);
        else if (name) patch({ stepError: `Please pick the school "${name}" from the list.` });
      } catch (err) {
        console.error('Could not open the order draft:', err);
        patch({ stepError: 'Could not open the order from Telegram. Check your connection and try again.' });
      }
    })();
  }, [draftId, patch, pickActingSchool, startNewOrder]);
  const newOrderMinDate = addDays(today, 3);
  // an edited order may keep the Function Date it already has, even when that's sooner
  const keptFunctionDate = editOrder?.functionDate ? toMalaysiaDay(editOrder.functionDate) : null;
  const dueMinDate = keptFunctionDate && keptFunctionDate < newOrderMinDate ? keptFunctionDate : newOrderMinDate;
  // Local, not AppState — this only matters while the teacher is on this
  // one screen (Next is blocked below until it settles), and doesn't need
  // to survive a navigation the way the rest of the draft does.
  const [logoUploading, setLogoUploading] = useState(false);

  // ImageDrop hands back a data URL for an instant local preview (it's
  // shared with Production/Admin's own reference-image uploaders, which
  // still store that data URL directly — see ImageDrop.jsx) — this
  // uploads it to Storage in the background and swaps state.logoDataUrl
  // to the real public URL once that finishes, so what actually gets
  // saved on the order is a small URL, not the whole image.
  const handleLogoChange = async (dataUrl, fileName) => {
    patch({ logoDataUrl: dataUrl, logoFileName: fileName, stepError: '' });
    setLogoUploading(true);
    try {
      const publicUrl = await uploadLogo(dataUrl, fileName);
      // Only apply the finished upload if the teacher is still on this same
      // pick — they may have switched back to "SK" (no logo needed) or
      // picked a different file while this one was still uploading.
      patch((st) => (st.schoolType === 'NOT_SK' && st.logoFileName === fileName ? { logoDataUrl: publicUrl } : {}));
    } catch (err) {
      console.error('Failed to upload logo to Storage:', err);
      patch((st) => (st.logoFileName === fileName
        ? { logoDataUrl: null, logoFileName: '', stepError: 'Could not upload the logo. Please try again.' }
        : {}));
    } finally {
      setLogoUploading(false);
    }
  };

  // Re-checks the database every time the New Order flow starts (not just
  // once at login) — School->Salesman is admin-managed and can change
  // mid-session, so the New Order screen must never rely on a value that
  // might already be stale. The actual enforcement is server-side (see
  // supabase/migrations/0025_allow_multiple_salesmen_per_school.sql); this
  // just keeps what's shown here honest.
  useEffect(() => { if (!editing) refreshAssignedSalesman(); }, [editing, refreshAssignedSalesman]);

  const cancelEdit = () => {
    const id = state.editOrderId;
    startNewOrder();
    navigate(`/sales/orders/${id}`);
  };

  const handleNext = () => {
    if (!editing && isSalesman && !state.actingSchoolId) {
      patch({ stepError: 'Please pick the school from the list.' });
      return;
    }
    if (!state.sekolah.trim()) {
      patch({ stepError: 'Please enter the school name.' });
      return;
    }
    if (!editing && !state.selectedSalesmanId) {
      patch({ stepError: state.assignedSalesmen.length === 0 ? 'Your school has not been assigned to a salesman yet. Please contact the administrator.' : 'Please select which salesman this order is for.' });
      return;
    }
    if (!state.picName.trim()) {
      patch({ stepError: 'Please enter the PIC (Cikgu) name.' });
      return;
    }
    if (!state.phone.trim()) {
      patch({ stepError: 'Please enter a phone number.' });
      return;
    }
    if (!/^[0-9-]+$/.test(state.phone.trim())) {
      patch({ stepError: 'Phone number can only contain numbers and "-".' });
      return;
    }
    if (!state.ketuaPanitia.trim()) {
      patch({ stepError: 'Please enter the Ketua Panitia.' });
      return;
    }
    if (!state.terms) {
      patch({ stepError: 'Please select terms.' });
      return;
    }
    if (!state.funcSelected) {
      patch({ stepError: 'Please select a function date.' });
      return;
    }
    if (editing && state.shipmentDateSelected && state.shipmentDateSelected > state.funcSelected) {
      patch({ stepError: 'Shipment Date can’t be after the Function Date.' });
      return;
    }
    if (!state.schoolType) {
      patch({ stepError: 'Please select whether the school is SK or Others.' });
      return;
    }
    if (state.schoolType === 'NOT_SK' && logoUploading) {
      patch({ stepError: 'Please wait for the logo to finish uploading.' });
      return;
    }
    if (state.schoolType === 'NOT_SK' && !state.logoDataUrl) {
      patch({ stepError: 'Please upload the logo (required for Others schools).' });
      return;
    }
    if (state.schoolType === 'NOT_SK' && !state.logoRemark.trim()) {
      patch({ stepError: 'Please fill in the remark to specify the logo.' });
      return;
    }
    patch({ stepError: '' });
    navigate('/order/step2');
  };

  return (
    <div className="screen-wrap">
      <Nav />

      {state.draftRestoredToast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {state.draftRestoredToast}
        </div>
      )}

      <div className="step-header">
        <div className="step step-active">
          <div className="step-dot">1</div>
          <span>Function Details</span>
        </div>
        <div className="step-line" />
        <div className="step step-upcoming">
          <div className="step-dot step-dot-outline">2</div>
          <span>Order Details</span>
        </div>
      </div>

      <div className="card elev-md">
        <div className="card-kicker">{editing ? `Edit Order — ${state.editOrderId}` : 'New Order — Function'}</div>
        <div className="card-title" style={{ marginBottom: editing ? 'var(--space-2)' : 'var(--space-6)' }}>Function Details</div>
        {editing && (
          <p className="hint-text" style={{ margin: '0 0 var(--space-6)' }}>
            Change anything on this order, then Next → Order Details (upload a newer order file there if you have one) → Save Changes.
            Production hasn&apos;t reviewed it yet; once they have, it can no longer be edited here.
          </p>
        )}

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="sekolah">Sekolah (School Name)</label>
            {editing
              ? <input className="input" id="sekolah" disabled readOnly value={state.sekolah} />
              : isSalesman
              ? <SchoolSearch value={state.sekolah} picked={!!state.actingSchoolId} onPick={pickActingSchool} />
              : <input className="input" id="sekolah" placeholder="School name" value={state.sekolah} onChange={(e) => patch({ sekolah: e.target.value })} />}
          </div>
          <div className="field">
            <label htmlFor="sales">Sales</label>
            {editing ? (
              <input className="input" id="sales" disabled readOnly value={state.sales} />
            ) : !state.assignedSalesmanLoaded ? (
              <input className="input" id="sales" disabled readOnly value="Loading..." />
            ) : state.assignedSalesmen.length > 1 ? (
              <select
                className="input"
                id="sales"
                value={state.selectedSalesmanId}
                onChange={(e) => {
                  const chosen = state.assignedSalesmen.find((s) => s.id === e.target.value);
                  patch({ selectedSalesmanId: e.target.value, sales: chosen?.name || '' });
                }}
              >
                <option value="">Select a salesman...</option>
                {state.assignedSalesmen.map((s) => <option key={s.id} value={s.id}>{s.name || 'Unnamed salesman'}</option>)}
              </select>
            ) : (
              <input
                className="input"
                id="sales"
                disabled
                readOnly
                value={state.assignedSalesmen[0] ? (state.assignedSalesmen[0].name || 'Unnamed salesman') : 'No salesman assigned'}
              />
            )}
            {state.assignedSalesmanLoaded && state.assignedSalesmen.length === 0 && (
              <p className="hint-text" style={{ margin: 'var(--space-2) 0 0', color: '#b3261e' }}>
                No salesman accounts exist yet. Please contact the administrator.
              </p>
            )}
          </div>
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="picName">PIC Name (Cikgu)</label>
            <input className="input" id="picName" placeholder="Person in charge" value={state.picName} onChange={(e) => patch({ picName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone Number</label>
            <input className="input" id="phone" placeholder="e.g. 012-3456789" value={state.phone} onChange={(e) => patch({ phone: e.target.value.replace(/[^0-9-]/g, '') })} />
          </div>
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="ketuaPanitia">Ketua Panitia</label>
            <input className="input" id="ketuaPanitia" placeholder="e.g. Ketua Panitia Matematik" value={state.ketuaPanitia} onChange={(e) => patch({ ketuaPanitia: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="terms">Terms</label>
            <select className="input" id="terms" value={state.terms} onChange={(e) => patch({ terms: e.target.value })}>
              <option value="">Select terms</option>
              <option value="L/O">L/O</option>
              <option value="Cash">Cash</option>
            </select>
          </div>
        </div>

        <div className="form-grid-2">
          <DatePicker label="Function Date" id="funcDate" selected={state.funcSelected} onSelect={(d) => patch({ funcSelected: d })} today={today} minDate={dueMinDate} />
          {editing && (
            <DatePicker label="Shipment Date (optional)" id="shipDate" selected={state.shipmentDateSelected} onSelect={(d) => patch({ shipmentDateSelected: d })} today={today} minDate={today} />
          )}
        </div>
        <p className="hint-text" style={{ marginBottom: 'var(--space-4)' }}>
          Function Date must be on or after {formatDate(dueMinDate)}{dueMinDate < newOrderMinDate ? ' (the date this order already has, or later)' : ' (at least 4 days from today, including today)'}.
          {editing && ' The Shipment Date can also be set when you approve the order.'}
        </p>

        <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
          <label>Logo Type</label>
          <div className="tabs">
            <button
              type="button"
              className={`btn ${state.schoolType === 'SK' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => patch({ schoolType: 'SK', logoDataUrl: null, logoFileName: '', logoRemark: '', stepError: '' })}
            >
              SK
            </button>
            <button
              type="button"
              className={`btn ${state.schoolType === 'NOT_SK' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => patch({ schoolType: 'NOT_SK', stepError: '' })}
            >
              Others
            </button>
          </div>
          {state.schoolType === 'NOT_SK' && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <label>Logo</label>
              <ImageDrop
                value={state.logoDataUrl}
                fileName={logoUploading ? `Uploading ${state.logoFileName}…` : state.logoFileName}
                onChange={handleLogoChange}
                placeholder="Upload logo"
                subtext="PNG or JPG, click to browse"
              />
              <div className="field" style={{ marginTop: 'var(--space-4)' }}>
                <label htmlFor="logoRemark">Remark (Please Specific Logo)</label>
                <textarea className="input" id="logoRemark" rows={2} placeholder="Describe the logo to be used" value={state.logoRemark} onChange={(e) => patch({ logoRemark: e.target.value, stepError: '' })} />
              </div>
            </div>
          )}
        </div>

        {state.schoolType !== 'NOT_SK' && (
          <div className="field" style={{ marginBottom: 'var(--space-8)' }}>
            <label htmlFor="remark">Remark</label>
            <textarea className="input" id="remark" rows={3} placeholder="Any additional notes for this order" value={state.remark} onChange={(e) => patch({ remark: e.target.value })} />
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 'var(--space-4)' }}>
          {editing && <button type="button" className="btn btn-ghost" style={{ marginRight: 'auto' }} onClick={cancelEdit}>Cancel Edit</button>}
          {state.stepError && <span className="hint-text" style={{ margin: 0, color: '#b3261e' }}>{state.stepError}</span>}
          <button type="button" className="btn btn-primary" onClick={handleNext}>
            Next Step
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 6 }}>
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
