import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import DatePicker from '../components/DatePicker';
import ImageDrop from '../components/ImageDrop';
import { useAppState } from '../state/useAppState';
import { formatDate } from '../data/catalog';

export default function NewOrderStep1() {
  const { state, patch, today } = useAppState();
  const navigate = useNavigate();

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
            <input className="input" id="sales" placeholder="Sales representative" value={state.sales} onChange={(e) => patch({ sales: e.target.value })} />
          </div>
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
            onSelect={(d) => patch((st) => ({
              dueSelected: d,
              // A due date change can leave a previously-picked function
              // date now falling before it — clear it rather than leave an
              // invalid combination sitting in the form.
              funcSelected: st.funcSelected && st.funcSelected < d ? null : st.funcSelected,
            }))}
          />
          <DatePicker label="Function Date" id="funcDate" selected={state.funcSelected} onSelect={(d) => patch({ funcSelected: d })} today={today} minDate={state.dueSelected} />
        </div>
        {state.dueSelected && (
          <p className="hint-text" style={{ marginBottom: 'var(--space-4)' }}>
            Function Date must be on or after the Due Date ({formatDate(state.dueSelected)}).
          </p>
        )}

        <div className="field" style={{ marginBottom: 'var(--space-6)' }}>
          <label>School Logo</label>
          <ImageDrop
            value={state.logoDataUrl}
            fileName={state.logoFileName}
            onChange={(url, fileName) => patch({ logoDataUrl: url, logoFileName: fileName })}
            placeholder="Upload school logo"
            subtext="PNG or JPG, click to browse"
          />
        </div>

        <div className="field" style={{ marginBottom: 'var(--space-8)' }}>
          <label htmlFor="remark">Remark</label>
          <textarea className="input" id="remark" rows={3} placeholder="Any additional notes for this order" value={state.remark} onChange={(e) => patch({ remark: e.target.value })} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/order/step2')}>
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
