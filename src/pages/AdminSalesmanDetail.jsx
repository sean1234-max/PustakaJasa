import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import {
  fetchAllProfiles, fetchSalesmanAssignments, updateProfile, resetPassword,
  assignSalesman, unassignSalesman, logAdminAction,
} from '../lib/adminApi';

export default function AdminSalesmanDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const [profiles, setProfiles] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [pendingSchoolId, setPendingSchoolId] = useState('');
  const [confirmingStatus, setConfirmingStatus] = useState(null);
  const [newPassword, setNewPassword] = useState('');

  const load = () => {
    Promise.all([fetchAllProfiles(), fetchSalesmanAssignments()])
      .then(([p, a]) => { setProfiles(p); setAssignments(a); })
      .catch((err) => console.error('Failed to load salesman:', err));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!profiles) return <div className="screen-wrap"><Nav /><p className="hint-text">Loading...</p></div>;

  const salesman = profiles.find((p) => p.id === id);
  if (!salesman) return <div className="screen-wrap"><Nav /><p className="hint-text">Salesman not found.</p></div>;

  const allSchools = profiles.filter((p) => p.role === 'teacher');
  const assignedTeacherIds = assignments.filter((a) => a.salesman_id === id).map((a) => a.teacher_id);
  const assignedSchools = allSchools.filter((s) => assignedTeacherIds.includes(s.id));
  const unassignedSchools = allSchools.filter((s) => !assignedTeacherIds.includes(s.id));
  const salesmanOrders = (state.orders || []).filter((o) => assignedTeacherIds.includes(o.createdBy));

  const handleAssign = async () => {
    if (!pendingSchoolId) return;
    const school = allSchools.find((s) => s.id === pendingSchoolId);
    try {
      await assignSalesman(id, pendingSchoolId);
      await logAdminAction({
        action: 'Admin assigned a school to a salesman',
        targetTable: 'salesman_assignments',
        targetId: pendingSchoolId,
        after: { salesman: salesman.display_name, school: school?.sekolah },
      });
      setToast(`${school?.sekolah || 'School'} has been assigned to ${salesman.display_name}.`);
      setPendingSchoolId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnassign = async (schoolId) => {
    const school = allSchools.find((s) => s.id === schoolId);
    try {
      await unassignSalesman(id, schoolId);
      await logAdminAction({
        action: 'Admin unassigned a school from a salesman',
        targetTable: 'salesman_assignments',
        targetId: schoolId,
        before: { salesman: salesman.display_name, school: school?.sekolah },
      });
      setToast(`${school?.sekolah || 'School'} has been unassigned.`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmStatus = async (newStatus) => {
    try {
      await updateProfile(id, { status: newStatus });
      await logAdminAction({
        action: 'Admin changed a salesman account status',
        targetTable: 'profiles',
        targetId: id,
        before: { status: salesman.status },
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
      await logAdminAction({ action: 'Admin changed a salesman password', targetTable: 'profiles', targetId: id });
      setToast('Password changed successfully.');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <button type="button" className="btn btn-ghost" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate('/admin/salesmen')}>← Back to Salesmen</button>

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
            <div className="card-kicker">Salesman</div>
            <div className="card-title">{salesman.display_name || '—'}</div>
          </div>
          <span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }}>{salesman.status}</span>
        </div>
        <div><div className="dim">Email</div><div>{salesman.email || '—'}</div></div>

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Assigned Schools</div>
        {assignedSchools.length === 0 ? (
          <p className="hint-text">No schools assigned yet.</p>
        ) : (
          <table className="table">
            <thead><tr><th>School</th><th>Teacher</th><th /></tr></thead>
            <tbody>
              {assignedSchools.map((s) => (
                <tr key={s.id}>
                  <td>{s.sekolah}</td>
                  <td>{s.display_name}</td>
                  <td><button type="button" className="btn btn-ghost" onClick={() => handleUnassign(s.id)}>Unassign</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <select className="input" value={pendingSchoolId} onChange={(e) => setPendingSchoolId(e.target.value)}>
            <option value="">Select a school to assign...</option>
            {unassignedSchools.map((s) => <option key={s.id} value={s.id}>{s.sekolah}</option>)}
          </select>
          <button type="button" className="btn btn-secondary" disabled={!pendingSchoolId} onClick={handleAssign}>Assign School</button>
        </div>

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Order Performance</div>
        <div className="stat-grid">
          <div className="stat-tile"><div className="stat-tile-value">{salesmanOrders.length}</div><div className="stat-tile-label">Total Orders</div></div>
          <div className="stat-tile"><div className="stat-tile-value">{salesmanOrders.filter((o) => o.status === 'Submitted to Sales').length}</div><div className="stat-tile-label">Pending</div></div>
          <div className="stat-tile"><div className="stat-tile-value">{salesmanOrders.filter((o) => o.status === 'Completed').length}</div><div className="stat-tile-label">Completed</div></div>
        </div>

        <div className="card-kicker">Account Status</div>
        {confirmingStatus ? (
          <div className="card" style={{ background: 'var(--color-accent-100)', border: 'none', padding: 'var(--space-4)' }}>
            <p style={{ margin: '0 0 var(--space-3)' }}>
              Are you sure you want to {confirmingStatus === 'active' ? 'reactivate' : 'deactivate'} <strong>{salesman.display_name}</strong>?<br />
              {confirmingStatus !== 'active' && 'This salesman will no longer be able to log in, but their assigned schools and order history will remain.'}
            </p>
            <div className="row-split">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmingStatus(null)}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => handleConfirmStatus(confirmingStatus)}>Confirm</button>
            </div>
          </div>
        ) : salesman.status === 'active' ? (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmingStatus('inactive')}>Deactivate Salesman</button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={() => setConfirmingStatus('active')}>Reactivate Salesman</button>
        )}

        <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Change Password</div>
        <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <input className="input" type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <button type="button" className="btn btn-secondary" onClick={handleResetPassword}>Change Password</button>
        </div>
      </div>
    </div>
  );
}
