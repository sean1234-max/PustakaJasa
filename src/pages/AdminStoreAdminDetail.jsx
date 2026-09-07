import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import AdminProfileEditor from '../components/AdminProfileEditor';
import { useAppState } from '../state/useAppState';
import {
  fetchAllProfiles, fetchInvoicingSalesmanAssignments, assignInvoicingSalesman, unassignInvoicingSalesman,
  updateProfile, resetPassword, deleteAccount, logAdminAction,
} from '../lib/adminApi';

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

// Admin's Store Admin detail page — same shape as AdminSalesmanDetail.jsx.
// A Store Admin (role 'store_admin', formerly 'invoicing') has no orders of
// their own; the stats and assigned-salesmen list are derived from
// invoicing_salesman_assignments (table name kept from the old role).
export default function AdminStoreAdminDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { state } = useAppState();
  const [profiles, setProfiles] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [confirmingStatus, setConfirmingStatus] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    Promise.all([fetchAllProfiles(), fetchInvoicingSalesmanAssignments()])
      .then(([p, a]) => { setProfiles(p); setAssignments(a); })
      .catch((err) => console.error('Failed to load store admin:', err));
  };

  useEffect(load, [id]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const salesmanIds = useMemo(
    () => new Set(assignments.filter((a) => a.invoicing_id === id).map((a) => a.salesman_id)),
    [assignments, id],
  );

  if (!profiles) return <AdminLayout title="Store Admin Details"><p className="text-body-md text-on-surface-variant">Loading...</p></AdminLayout>;

  const storeAdmin = profiles.find((p) => p.id === id && p.role === 'store_admin');
  if (!storeAdmin) return <AdminLayout title="Store Admin Details"><p className="text-body-md text-on-surface-variant">Store Admin not found.</p></AdminLayout>;

  const assignedSalesmen = profiles.filter((p) => salesmanIds.has(p.id));
  const salesmanOptions = profiles.filter((p) => p.role === 'salesman');
  const orders = (state.orders || []).filter((o) => salesmanIds.has(o.salesmanId));

  const handleToggleSalesman = async (salesmanId, checked) => {
    try {
      if (checked) await assignInvoicingSalesman(id, salesmanId);
      else await unassignInvoicingSalesman(id, salesmanId);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConfirmStatus = async (newStatus) => {
    try {
      await updateProfile(id, { status: newStatus });
      await logAdminAction({
        action: 'Admin changed a store admin account status',
        targetTable: 'profiles',
        targetId: id,
        before: { status: storeAdmin.status },
        after: { status: newStatus },
      });
      setToast(`Account status changed to ${newStatus}.`);
      setConfirmingStatus(null);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Permanently delete ${storeAdmin.display_name || storeAdmin.email || 'this Store Admin'}? This can't be undone. If the account has order or activity history, deletion will be blocked — deactivate it instead.`)) return;
    setDeleting(true);
    try {
      await deleteAccount(id);
      await logAdminAction({
        action: 'Admin deleted a store admin account',
        targetTable: 'profiles',
        targetId: id,
        before: { display_name: storeAdmin.display_name, email: storeAdmin.email, role: storeAdmin.role },
      });
      navigate('/admin/store-admins');
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    try {
      await resetPassword(id, newPassword);
      await logAdminAction({ action: 'Admin changed a store admin password', targetTable: 'profiles', targetId: id });
      setToast('Password changed successfully.');
      setNewPassword('');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <AdminLayout>
      <button type="button" onClick={() => navigate('/admin/store-admins')} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors w-fit mb-6">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        <span className="text-label-bold font-semibold">Back to Store Admin</span>
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
            <span className="text-label-bold text-secondary uppercase tracking-wider">Store Admin</span>
            <h2 className="text-display-lg text-on-surface">{storeAdmin.display_name || '—'}</h2>
            <div className="mt-4 flex flex-col gap-1">
              <span className="text-body-sm text-on-surface-variant">Email</span>
              <span className="text-body-md text-on-surface">{storeAdmin.email || '—'}</span>
            </div>
          </div>
          <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-primary/10 text-primary text-label-bold font-semibold uppercase tracking-wide border border-primary/20">
            {storeAdmin.status}
          </span>
        </section>

        <hr className="border-outline-variant/50" />

        <div className="relative z-10">
          <AdminProfileEditor profile={storeAdmin} onSaved={load} setToast={setToast} setError={setError} />
        </div>

        <hr className="border-outline-variant/50" />

        <section className="flex flex-col gap-6 relative z-10">
          <h3 className="text-label-bold text-secondary uppercase tracking-wider">Order Scope (assigned salesmen)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard value={assignedSalesmen.length} label="Assigned Salesmen" icon="badge" />
            <StatCard value={orders.length} label="Orders In Scope" icon="shopping_bag" />
            <StatCard value={orders.filter((o) => o.status === 'Submitted to Sales').length} label="Awaiting Approval" icon="pending_actions" />
          </div>
          <div className="max-w-xl">
            <h4 className="text-label-bold text-on-surface-variant uppercase tracking-wider mb-3">Assigned Salesmen</h4>
            <p className="text-body-sm text-on-surface-variant mb-3">
              This Store Admin only sees orders from the salesmen ticked below.
            </p>
            {salesmanOptions.length === 0 ? (
              <span className="text-body-sm text-on-surface-variant">No salesman accounts exist yet.</span>
            ) : (
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto border border-outline-variant rounded-lg p-3 bg-surface-container-lowest">
                {salesmanOptions.map((sm) => (
                  <label key={sm.id} className="flex items-center gap-2 text-body-md text-on-surface">
                    <input
                      type="checkbox"
                      checked={salesmanIds.has(sm.id)}
                      onChange={(e) => handleToggleSalesman(sm.id, e.target.checked)}
                    />
                    {sm.display_name || sm.email}
                  </label>
                ))}
              </div>
            )}
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
                  Are you sure you want to {confirmingStatus === 'active' ? 'reactivate' : 'deactivate'} <strong>{storeAdmin.display_name}</strong>?<br />
                  {confirmingStatus !== 'active' && 'This Store Admin will no longer be able to log in, but their assignments and order history will remain.'}
                </p>
                <div className="flex justify-between gap-3">
                  <button type="button" onClick={() => setConfirmingStatus(null)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2">Cancel</button>
                  <button type="button" onClick={() => handleConfirmStatus(confirmingStatus)} className="bg-primary text-on-primary text-label-bold font-semibold px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors">Confirm</button>
                </div>
              </div>
            ) : storeAdmin.status === 'active' ? (
              <div>
                <button type="button" onClick={() => setConfirmingStatus('inactive')} className="bg-error/10 border border-error/20 text-error text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-error hover:text-white transition-colors">
                  Deactivate Store Admin
                </button>
                <p className="text-body-sm text-on-surface-variant mt-3 max-w-xs">Deactivating this user will prevent them from accessing the system.</p>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmingStatus('active')} className={secondaryBtnClass}>Reactivate Store Admin</button>
            )}
          </section>
        </div>

        <hr className="border-outline-variant/50" />

        <section className="flex flex-col gap-3 relative z-10 max-w-xl">
          <h3 className="text-label-bold text-error uppercase tracking-wider">Danger Zone</h3>
          <p className="text-body-sm text-on-surface-variant">
            Permanently deletes this account and its login. Blocked if the account has order or
            activity history — deactivate it instead in that case.
          </p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="w-full sm:w-auto bg-error-container text-on-error-container text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete Store Admin'}
          </button>
        </section>
      </div>
    </AdminLayout>
  );
}
