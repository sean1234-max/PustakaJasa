import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import DatePicker from '../components/DatePicker';
import ImageDrop from '../components/ImageDrop';
import SalesCombobox from '../components/SalesCombobox';
import { useAppState } from '../state/useAppState';
import { formatDate, addDays, SALES_NAMES } from '../data/catalog';

export default function NewOrderStep1() {
  const { state, patch, today } = useAppState();
  const navigate = useNavigate();
  const dueMinDate = addDays(today, 3);

  const handleNext = () => {
    if (!state.schoolType) {
      patch({ stepError: 'Please select whether the school is SK or Not SK.' });
      return;
    }
    if (state.schoolType === 'NOT_SK' && !state.logoDataUrl) {
      patch({ stepError: 'Please upload the logo (required for Not SK schools).' });
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
          <SalesCombobox id="sales" value={state.sales} onChange={(name) => patch({ sales: name })} options={SALES_NAMES} />
        </div>

        <div className="form-grid-2">
          <div className="field">
            <label htmlFor="picName">PIC Name (Cikgu)</label>
            <input className="input" id="picName" placeholder="Person in charge" value={state.picName} onChange={(e) => patch({ picName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone Number</label>
            <input className="input" id="phone" placeholder="e.g. 012-345 6789" value={state.phone} onChange={(e) => patch({ phone: e.target.value })} />
          </div>
        </div>

        <div className="form-grid-2">
          <DatePicker
            label="Due Date"
            id="dueDate"
            selected={state.dueSelected}
            today={today}
            minDate={dueMinDate}
            onSelect={(d) => patch((st) => ({
              dueSelected: d,
              // A due date change can leave a previously-picked function
              // date now falling before it — clear it rather than leave an
              // invalid combination sitting in the form.
              funcSelected: st.funcSelected && st.funcSelected < d ? null : st.funcSelected,
            }))}
          />
          <DatePicker label="Function Date" id="funcDate" selected={state.funcSelected} onSelect={(d) => patch({ funcSelected: d })} today={today} minDate={state.dueSelected || dueMinDate} />
        </div>
        <p className="hint-text" style={{ marginBottom: 'var(--space-4)' }}>
          Due Date must be on or after {formatDate(dueMinDate)} (at least 4 days from today, including today).
          {state.dueSelected && ` Function Date must be on or after the Due Date (${formatDate(state.dueSelected)}).`}
        </p>

        <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
          <label>School Type</label>
          <div className="tabs">
            <button
              type="button"
              className={`btn ${state.schoolType === 'SK' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => patch({ schoolType: 'SK', logoDataUrl: null, logoFileName: '', stepError: '' })}
            >
              SK
            </button>
            <button
              type="button"
              className={`btn ${state.schoolType === 'NOT_SK' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => patch({ schoolType: 'NOT_SK', stepError: '' })}
            >
              Not SK
            </button>
          </div>
          {state.schoolType === 'NOT_SK' && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <label>Logo</label>
              <ImageDrop
                value={state.logoDataUrl}
                fileName={state.logoFileName}
                onChange={(url, fileName) => patch({ logoDataUrl: url, logoFileName: fileName, stepError: '' })}
                placeholder="Upload logo"
                subtext="PNG or JPG, click to browse"
              />
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 'var(--space-8)' }}>
          <label htmlFor="remark">Remark</label>
          <textarea className="input" id="remark" rows={3} placeholder="Any additional notes for this order" value={state.remark} onChange={(e) => patch({ remark: e.target.value })} />
        </div>

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
