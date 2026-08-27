import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import DatePicker from '../components/DatePicker';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { formatDate, addDays } from '../data/catalog';
import { uploadLogo } from '../lib/storageApi';

export default function NewOrderStep1() {
  const { state, patch, today, refreshAssignedSalesman } = useAppState();
  const navigate = useNavigate();
  const dueMinDate = addDays(today, 3);
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
  useEffect(() => { refreshAssignedSalesman(); }, [refreshAssignedSalesman]);

  const handleNext = () => {
    if (!state.sekolah.trim()) {
      patch({ stepError: 'Please enter the school name.' });
      return;
    }
    if (!state.selectedSalesmanId) {
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
        <div className="card-kicker">New Order — Function</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-6)' }}>Function Details</div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="sekolah">Sekolah (School Name)</label>
            <input className="input" id="sekolah" placeholder="School name" value={state.sekolah} onChange={(e) => patch({ sekolah: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sales">Sales</label>
            {!state.assignedSalesmanLoaded ? (
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
        </div>
        <p className="hint-text" style={{ marginBottom: 'var(--space-4)' }}>
          Function Date must be on or after {formatDate(dueMinDate)} (at least 4 days from today, including today).
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
