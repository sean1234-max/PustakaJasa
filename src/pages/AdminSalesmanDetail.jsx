import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import {
  fetchAllProfiles, fetchSalesmanAssignments, updateProfile, resetPassword,
  assignSalesman, unassignSalesman, logAdminAction,
} from '../lib/adminApi';

const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary py-2.5 px-4 shadow-sm outline-none transition-all';
const secondaryBtnClass = 'w-full sm:w-auto bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:text-on-surface text-label-bold font-semibold py-2.5 px-4 rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';

function StatCard({ value, label, icon }) {
  return (
    <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-5 shadow-sm hover:shadow-md transition-shadow duration-300 flex flex-col justify-between h-32">
      <div className="flex items-center justify-between">
        <span className="text-stat-lg text-on-surface">{value}</span>
        <span className="material-symbols-outlined text-outline-variant">{icon}</span>
      </div>
      <span className="text-body-sm text-on-surface-variant mt-2">{label}</span>
    </div>
  );
}

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

  if (!profiles) return <AdminLayout title="Salesman Details"><p className="text-body-md text-on-surface-variant">Loading...</p></AdminLayout>;

  const salesman = profiles.find((p) => p.id === id);
  if (!salesman) return <AdminLayout title="Salesman Details"><p className="text-body-md text-on-surface-variant">Salesman not found.</p></AdminLayout>;

  const allSchools = profiles.filter((p) => p.role === 'teacher');
  const assignedTeacherIds = assignments.filter((a) => a.salesman_id === id).map((a) => a.teacher_id);
  const assignedSchools = allSchools.filter((s) => assignedTeacherIds.includes(s.id));
  // A school may now be assigned to more than one salesman (see
  // supabase/migrations/0025_allow_multiple_salesmen_per_school.sql) — so
  // "available to assign" only excludes schools already assigned to THIS
  // salesman, not schools assigned elsewhere.
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
    <AdminLayout>
      <button type="button" onClick={() => navigate('/admin/salesmen')} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors w-fit mb-6">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        <span className="text-label-bold font-semibold">Back to Salesmen</span>
      </button>

      {toast && (
        <div className="mb-6 flex items-center gap-2 bg-secondary-container/40 text-on-secondary-container px-4 py-3 rounded-lg text-body-md">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toast}
        </div>
      )}
      {error && <div className="mb-6 bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md">{error}</div>}

      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm p-8 lg:p-10 flex flex-col gap-10 relative overflow-hidden">
        <section className="flex flex-col md:flex-row md:items-start justify-between gap-6 relative z-10">
          <div className="flex flex-col gap-2">
            <span className="text-label-bold text-secondary uppercase tracking-wider">Salesman</span>
            <h2 className="text-display-lg text-on-surface">{salesman.display_name || '—'}</h2>
            <div className="mt-4 flex flex-col gap-1">
              <span className="text-body-sm text-on-surface-variant">Email</span>
              <span className="text-body-md text-on-surface">{salesman.email || '—'}</span>
            </div>
          </div>
          <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-primary/10 text-primary text-label-bold font-semibold uppercase tracking-wide border border-primary/20">
            {salesman.status}
          </span>
        </section>

        <hr className="border-outline-variant/50" />

        <section className="flex flex-col gap-6 relative z-10">
          <h3 className="text-label-bold text-secondary uppercase tracking-wider">Assigned Schools</h3>
          {assignedSchools.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant italic">No schools assigned yet.</p>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-outline-variant">
                    <th className="py-3 px-4 text-label-bold text-on-surface-variant uppercase w-1/2">School</th>
                    <th className="py-3 px-4 text-label-bold text-on-surface-variant uppercase w-1/4">Teacher</th>
                    <th className="py-3 px-4 text-label-bold text-on-surface-variant uppercase w-1/4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignedSchools.map((s) => (
                    <tr key={s.id} className="border-b border-outline-variant/50 hover:bg-surface-variant/30 transition-colors">
                      <td className="py-4 px-4 text-body-md text-on-surface font-medium">{s.sekolah}</td>
                      <td className="py-4 px-4 text-body-md text-on-surface-variant">{s.display_name}</td>
                      <td className="py-4 px-4 text-right">
                        <button type="button" onClick={() => handleUnassign(s.id)} className="text-label-bold font-semibold text-error hover:text-error hover:bg-error/10 px-3 py-1.5 rounded transition-colors">
                          Unassign
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {unassignedSchools.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant italic">No unassigned schools available.</p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <select className={`${inputClass} sm:w-2/3`} value={pendingSchoolId} onChange={(e) => setPendingSchoolId(e.target.value)}>
                <option value="">Select a school to assign...</option>
                {unassignedSchools.map((s) => <option key={s.id} value={s.id}>{s.sekolah}</option>)}
              </select>
              <button type="button" disabled={!pendingSchoolId} onClick={handleAssign} className={`${secondaryBtnClass} sm:w-1/3`}>Assign School</button>
            </div>
          )}
        </section>

        <hr className="border-outline-variant/50" />

        <section className="flex flex-col gap-6 relative z-10">
          <h3 className="text-label-bold text-secondary uppercase tracking-wider">Order Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard value={salesmanOrders.length} label="Total Orders" icon="shopping_bag" />
            <StatCard value={salesmanOrders.filter((o) => o.status === 'Submitted to Sales').length} label="Pending" icon="pending_actions" />
            <StatCard value={salesmanOrders.filter((o) => o.status === 'Completed').length} label="Completed" icon="check_circle" />
          </div>
        </section>

        <hr className="border-outline-variant/50" />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 relative z-10">
          <section className="flex flex-col gap-4">
            <h3 className="text-label-bold text-secondary uppercase tracking-wider">Change Password</h3>
            <div className="flex flex-col sm:flex-row gap-4">
              <input className="flex-1 bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2 text-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-on-surface-variant/60" placeholder="At least 6 characters" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              <button type="button" onClick={handleResetPassword} className="bg-surface-container border border-outline-variant text-on-surface text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-surface-variant transition-colors whitespace-nowrap">
                Change Password
              </button>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="text-label-bold text-secondary uppercase tracking-wider">Account Status</h3>
            {confirmingStatus ? (
              <div className="bg-secondary-container/30 rounded-lg p-4">
                <p className="mb-3 text-body-md text-on-surface">
                  Are you sure you want to {confirmingStatus === 'active' ? 'reactivate' : 'deactivate'} <strong>{salesman.display_name}</strong>?<br />
                  {confirmingStatus !== 'active' && 'This salesman will no longer be able to log in, but their assigned schools and order history will remain.'}
                </p>
                <div className="flex justify-between gap-3">
                  <button type="button" onClick={() => setConfirmingStatus(null)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2">Cancel</button>
                  <button type="button" onClick={() => handleConfirmStatus(confirmingStatus)} className="bg-primary text-on-primary text-label-bold font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">Confirm</button>
                </div>
              </div>
            ) : salesman.status === 'active' ? (
              <div>
                <button type="button" onClick={() => setConfirmingStatus('inactive')} className="bg-error/10 border border-error/20 text-error text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-error hover:text-white transition-colors">
                  Deactivate Salesman
                </button>
                <p className="text-body-sm text-on-surface-variant mt-3 max-w-xs">Deactivating this user will prevent them from accessing the system.</p>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingStatus('active')} className={secondaryBtnClass}>Reactivate Salesman</button>
            )}
          </section>
        </div>
      </div>
    </AdminLayout>
  );
}
