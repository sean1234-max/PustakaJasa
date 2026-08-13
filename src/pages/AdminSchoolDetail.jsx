import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';
import {
  fetchAllProfiles, fetchSalesmanAssignments, updateProfile, resetPassword,
  reassignSalesman, logAdminAction,
} from '../lib/adminApi';

export default function AdminSchoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const [profiles, setProfiles] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [pendingSalesmanId, setPendingSalesmanId] = useState('');
  const [confirmingReassign, setConfirmingReassign] = useState(false);
  const [confirmingStatus, setConfirmingStatus] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const load = () => {
    Promise.all([fetchAllProfiles(), fetchSalesmanAssignments()])
      .then(([p, a]) => { setProfiles(p); setAssignments(a); })
      .catch((err) => console.error('Failed to load school:', err));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!profiles) return <div className="screen-wrap"><Nav /><p className="hint-text">Loading...</p></div>;

  const school = profiles.find((p) => p.id === id);
  if (!school) return <div className="screen-wrap"><Nav /><p className="hint-text">School not found.</p></div>;

  const salesmenOptions = profiles.filter((p) => p.role === 'salesman');
  const currentAssignment = assignments.find((a) => a.teacher_id === id);
  const currentSalesman = currentAssignment ? salesmenOptions.find((s) => s.id === currentAssignment.salesman_id) : null;
  const orders = (state.orders || []).filter((o) => o.createdBy === id);

  const handleConfirmReassign = async () => {
    try {
      await reassignSalesman(currentAssignment?.salesman_id || null, pendingSalesmanId, id);
      const newSalesman = salesmenOptions.find((s) => s.id === pendingSalesmanId);
      await logAdminAction({
        action: 'Admin reassigned a school to a different salesman',
        targetTable: 'salesman_assignments',
        targetId: id,
        before: { salesman: currentSalesman?.display_name || 'None' },
        after: { salesman: newSalesman?.display_name || 'None' },
      });
      setToast(`This school has been assigned to ${newSalesman?.display_name || 'the selected salesman'}.`);
      setConfirmingReassign(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmStatus = async (newStatus) => {
    try {
      await updateProfile(id, { status: newStatus });
      await logAdminAction({
        action: 'Admin changed a school account status',
        targetTable: 'profiles',
        targetId: id,
        before: { status: school.status },
        after: { status: newStatus },
      });
      setToast(`Account status changed to ${newStatus}.`);
      setConfirmingStatus(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    try {
      await resetPassword(id, newPassword);
      await logAdminAction({ action: 'Admin changed a school password', targetTable: 'profiles', targetId: id });
      setToast('Password changed successfully.');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/admin/schools')}>← Back to Schools</button>

      {toast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {toast}
        </div>
      )}
      {error && <div className="login-error">{error}</div>}

      <div className="card elev-md" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="order-card-top">
          <div>
            <div className="card-kicker">School</div>
            <div className="card-title">{school.sekolah || '—'}</div>
          </div>
          <span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }}>{school.status}</span>
        </div>

        <div className="form-grid-2" style={{ marginTop: 'var(--space-4)' }}>
          <div><div className="dim">Teacher Name</div><div>{school.display_name || '—'}</div></div>
          <div><div className="dim">Teacher Email</div><div>{school.email || '—'}</div></div>
        </div>

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Salesman</div>
        <p className="hint-text">Current: {currentSalesman?.display_name || 'None'}</p>
        {!confirmingReassign ? (
          <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
            <select className="input" value={pendingSalesmanId} onChange={(e) => setPendingSalesmanId(e.target.value)}>
              <option value="">Select a salesman...</option>
              {salesmenOptions.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.email}</option>)}
            </select>
            <button type="button" className="btn btn-secondary" disabled={!pendingSalesmanId} onClick={() => setConfirmingReassign(true)}>Change Salesman</button>
          </div>
        ) : (
          <div className="card" style={{ background: 'var(--color-accent-100)', border: 'none', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-3)' }}>
              Are you sure you want to change the salesman for <strong>{school.sekolah}</strong>?<br />
              Current: {currentSalesman?.display_name || 'None'}<br />
              New: {salesmenOptions.find((s) => s.id === pendingSalesmanId)?.display_name}
            </p>
            <div className="row-split">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmingReassign(false)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={handleConfirmReassign}>Confirm Change</button>
            </div>
          </div>
        )}

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Account Status</div>
        {confirmingStatus ? (
          <div className="card" style={{ background: 'var(--color-accent-100)', border: 'none', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-3)' }}>
              Are you sure you want to {confirmingStatus === 'active' ? 'reactivate' : 'deactivate'} <strong>{school.sekolah}</strong>?<br />
              {confirmingStatus !== 'active' && 'The school will no longer be able to log in, but existing orders will remain.'}
            </p>
            <div className="row-split">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmingStatus(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => handleConfirmStatus(confirmingStatus)}>Confirm</button>
            </div>
          </div>
        ) : school.status === 'active' ? (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmingStatus('inactive')}>Deactivate School</button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmingStatus('active')}>Reactivate School</button>
        )}

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Change Password</div>
        <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <input className="input" type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button type="button" className="btn btn-secondary" onClick={handleResetPassword}>Change Password</button>
        </div>
      </div>

      <div className="card-kicker">Order History</div>
      {orders.length === 0 ? (
        <p className="hint-text">No orders found for this school.</p>
      ) : (
        <div className="order-grid">
          {orders.map((ord) => {
            const idx = STATUS_STAGES.indexOf(ord.status);
            return (
              <div key={ord.id} className="card order-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/admin/orders/${ord.id}`)}>
                <div className="order-card-top">
                  <div>
                    <div className="order-card-label">Order ID</div>
                    <div className="order-card-id">{ord.id}</div>
                  </div>
                  <span className="status-pill" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>{ord.status}</span>
                </div>
                <div className="order-card-meta" style={{ gridTemplateColumns: '1fr' }}>
                  <div><div className="dim">Date Placed</div><div>{ord.datePlaced}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
