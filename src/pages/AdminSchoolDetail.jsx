import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { STATUS_STAGES, STATUS_BG, STATUS_TEXT } from '../data/catalog';
import {
  fetchAllProfiles, fetchSalesmanAssignments, updateProfile, resetPassword,
  assignSalesman, unassignSalesman, logAdminAction,
} from '../lib/adminApi';

const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary py-2.5 px-4 shadow-sm outline-none transition-all';
const secondaryBtnClass = 'w-full sm:w-auto bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:text-on-surface text-label-bold font-semibold py-2.5 px-4 rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';

export default function AdminSchoolDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const [profiles, setProfiles] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [pendingSalesmanId, setPendingSalesmanId] = useState('');
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

  if (!profiles) return <AdminLayout title="School Details"><p className="text-body-md text-on-surface-variant">Loading...</p></AdminLayout>;

  const school = profiles.find((p) => p.id === id);
  if (!school) return <AdminLayout title="School Details"><p className="text-body-md text-on-surface-variant">School not found.</p></AdminLayout>;

  const salesmenOptions = profiles.filter((p) => p.role === 'salesman');
  const assignedSalesmanIds = assignments.filter((a) => a.teacher_id === id).map((a) => a.salesman_id);
  const assignedSalesmen = salesmenOptions.filter((s) => assignedSalesmanIds.includes(s.id));
  const unassignedSalesmen = salesmenOptions.filter((s) => !assignedSalesmanIds.includes(s.id));
  const orders = (state.orders || []).filter((o) => o.createdBy === id);

  const handleAssign = async () => {
    if (!pendingSalesmanId) return;
    const newSalesman = salesmenOptions.find((s) => s.id === pendingSalesmanId);
    try {
      await assignSalesman(pendingSalesmanId, id);
      await logAdminAction({
        action: 'Admin assigned a salesman to a school',
        targetTable: 'salesman_assignments',
        targetId: id,
        after: { salesman: newSalesman?.display_name || 'None', school: school.sekolah },
      });
      setToast(`${school.sekolah || 'This school'} has been assigned to ${newSalesman?.display_name || 'the selected salesman'}.`);
      setPendingSalesmanId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleUnassign = async (salesmanId) => {
    const salesman = salesmenOptions.find((s) => s.id === salesmanId);
    try {
      await unassignSalesman(salesmanId, id);
      await logAdminAction({
        action: 'Admin unassigned a salesman from a school',
        targetTable: 'salesman_assignments',
        targetId: id,
        before: { salesman: salesman?.display_name || 'None', school: school.sekolah },
      });
      setToast(`${salesman?.display_name || 'Salesman'} has been unassigned from ${school.sekolah || 'this school'}.`);
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
    <AdminLayout>
      <button type="button" onClick={() => navigate('/admin/schools')} className="flex items-center text-on-surface-variant hover:text-primary transition-colors w-fit mb-6 group">
        <span className="material-symbols-outlined text-[18px] mr-1 group-hover:-translate-x-1 transition-transform">arrow_back</span>
        <span className="text-label-bold font-semibold">Back to Schools</span>
      </button>

      {toast && (
        <div className="mb-6 flex items-center gap-2 bg-secondary-container/40 text-on-secondary-container px-4 py-3 rounded-lg text-body-md">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toast}
        </div>
      )}
      {error && <div className="mb-6 bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md">{error}</div>}

      <section className="bg-surface-container-lowest rounded-xl border border-outline-variant shadow-sm overflow-hidden mb-10">
        <div className="p-6 md:p-8">
          <div className="flex justify-between items-start mb-8 pb-6 border-b border-outline-variant">
            <div>
              <span className="text-label-bold text-on-surface-variant uppercase tracking-widest mb-1 block">School</span>
              <h2 className="text-display-lg text-on-surface">{school.sekolah || '—'}</h2>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-md bg-secondary-container/30 text-primary-container text-label-bold font-semibold border border-secondary-container">
              {school.status}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
            <div>
              <span className="text-label-bold text-on-surface-variant mb-1 block">Teacher Name</span>
              <p className="text-headline-sm text-on-surface">{school.display_name || '—'}</p>
            </div>
            <div>
              <span className="text-label-bold text-on-surface-variant mb-1 block">Teacher Email</span>
              <p className="text-headline-sm text-on-surface-variant">{school.email || '—'}</p>
            </div>
          </div>

          <div className="space-y-8 bg-surface p-6 rounded-lg border border-outline-variant/50">
            <div>
              <div className="mb-4">
                <span className="text-label-bold text-on-surface-variant uppercase tracking-widest block mb-1">Salesmen</span>
                <span className="text-body-sm text-on-surface-variant">A school can be assigned to more than one salesman — the teacher picks which one when placing an order.</span>
              </div>
              {assignedSalesmen.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant italic mb-4">No salesmen assigned yet.</p>
              ) : (
                <ul className="mb-4 divide-y divide-outline-variant">
                  {assignedSalesmen.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-2.5">
                      <span className="text-body-md text-on-surface">{s.display_name || s.email}</span>
                      <button type="button" onClick={() => handleUnassign(s.id)} className="text-label-bold font-semibold text-error hover:text-error hover:bg-error/10 px-3 py-1.5 rounded transition-colors">
                        Unassign
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {unassignedSalesmen.length === 0 ? (
                <p className="text-body-sm text-on-surface-variant italic">No more salesmen available to assign.</p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <select className={`${inputClass} sm:w-2/3`} value={pendingSalesmanId} onChange={(e) => setPendingSalesmanId(e.target.value)}>
                    <option value="">Select a salesman...</option>
                    {unassignedSalesmen.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.email}</option>)}
                  </select>
                  <button type="button" disabled={!pendingSalesmanId} onClick={handleAssign} className={`${secondaryBtnClass} sm:w-1/3`}>
                    Assign Salesman
                  </button>
                </div>
              )}
            </div>

            <hr className="border-outline-variant" />

            <div>
              <div className="mb-4">
                <span className="text-label-bold text-on-surface-variant uppercase tracking-widest block mb-1">Change Password</span>
              </div>
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                <input className={`${inputClass} sm:w-2/3`} placeholder="At least 6 characters" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <button type="button" onClick={handleResetPassword} className={`${secondaryBtnClass} sm:w-1/3`}>Update Password</button>
              </div>
            </div>

            <hr className="border-outline-variant" />

            <div>
              <div className="mb-4">
                <span className="text-label-bold text-on-surface-variant uppercase tracking-widest block mb-1">Account Status</span>
              </div>
              {confirmingStatus ? (
                <div className="bg-secondary-container/30 rounded-lg p-4">
                  <p className="mb-3 text-body-md text-on-surface">
                    Are you sure you want to {confirmingStatus === 'active' ? 'reactivate' : 'deactivate'} <strong>{school.sekolah}</strong>?<br />
                    {confirmingStatus !== 'active' && 'The school will no longer be able to log in, but existing orders will remain.'}
                  </p>
                  <div className="flex justify-between gap-3">
                    <button type="button" onClick={() => setConfirmingStatus(null)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2">Cancel</button>
                    <button type="button" onClick={() => handleConfirmStatus(confirmingStatus)} className="bg-primary text-on-primary text-label-bold font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">Confirm</button>
                  </div>
                </div>
              ) : school.status === 'active' ? (
                <button type="button" onClick={() => setConfirmingStatus('inactive')} className="bg-error-container text-on-error-container text-label-bold font-semibold py-2.5 px-6 rounded-lg shadow-sm hover:shadow-md transition-all active:scale-95 border border-error-container/50">
                  Deactivate School
                </button>
              ) : (
                <button type="button" onClick={() => setConfirmingStatus('active')} className={secondaryBtnClass}>Reactivate School</button>
              )}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-6 flex justify-between items-end border-b border-outline-variant pb-2">
          <h3 className="text-headline-md text-on-surface">Order History</h3>
        </div>
        {orders.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">No orders found for this school.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {orders.map((ord) => {
              const idx = STATUS_STAGES.indexOf(ord.status);
              return (
                <button
                  type="button"
                  key={ord.id}
                  onClick={() => navigate(`/admin/orders/${ord.id}`)}
                  className="text-left bg-surface-container-lowest rounded-lg border border-outline-variant p-5 shadow-sm hover:shadow-lg transition-shadow duration-300"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <span className="text-label-bold text-on-surface-variant uppercase block mb-1">Order ID</span>
                      <span className="text-headline-sm text-primary">{ord.id}</span>
                    </div>
                    <span className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-semibold border border-outline-variant/30" style={{ background: STATUS_BG[idx], color: STATUS_TEXT[idx] }}>
                      {ord.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-body-sm text-on-surface-variant block mb-1">Date Placed</span>
                    <span className="text-body-md text-on-surface">{ord.datePlaced}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </AdminLayout>
  );
}
