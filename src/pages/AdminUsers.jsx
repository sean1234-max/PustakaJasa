import { Fragment, useEffect, useState } from 'react';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import {
  fetchAllProfiles, createAccount, updateProfile, resetPassword, deleteAccount, logAdminAction,
  fetchInvoicingSalesmanAssignments, assignInvoicingSalesman, unassignInvoicingSalesman,
} from '../lib/adminApi';

const ROLE_LABELS = { teacher: 'School', salesman: 'Salesman', production: 'Production', invoicing: 'Invoicing Department', admin: 'Admin' };
const ROLE_OPTIONS = Object.keys(ROLE_LABELS);
const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

const EMPTY_FORM = { role: 'teacher', sekolah: '', displayName: '', email: '', password: '', assignedSalesmanIds: [] };
const inputClass = 'w-full px-3 py-2 border border-outline-variant rounded-lg bg-surface-bright focus:ring-2 focus:ring-primary focus:border-primary text-body-md text-on-surface outline-none transition-all';

function Field({ label, htmlFor, children }) {
  return (
    <div className="mb-4">
      <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export default function AdminUsers() {
  const { state } = useAppState();
  const [profiles, setProfiles] = useState(null);
  const [invoicingAssignments, setInvoicingAssignments] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [newPassword, setNewPassword] = useState('');

  const load = () => {
    Promise.all([fetchAllProfiles(), fetchInvoicingSalesmanAssignments()])
      .then(([p, a]) => { setProfiles(p); setInvoicingAssignments(a); })
      .catch((err) => { console.error('Failed to load users:', err); setLoadError('Unable to load users. Please try again.'); });
  };

  useEffect(load, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const salesmenOptions = (profiles || []).filter((p) => p.role === 'salesman');

  const filtered = (profiles || []).filter((p) => {
    if (roleFilter !== 'all' && p.role !== roleFilter) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [p.display_name, p.email, p.sekolah].some((v) => (v || '').toLowerCase().includes(q));
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.email.trim() || !form.password) {
      setFormError('Email and password are required.');
      return;
    }
    if (form.role !== 'teacher' && !form.displayName.trim()) {
      setFormError('Name is required.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (form.password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    if (form.role === 'teacher' && !form.sekolah.trim()) {
      setFormError('School Name is required.');
      return;
    }
    setSaving(true);
    try {
      const result = await createAccount({
        role: form.role,
        sekolah: form.role === 'teacher' ? form.sekolah.trim() : null,
        displayName: form.displayName.trim() || null,
        email: form.email.trim(),
        password: form.password,
      });
      if (form.role === 'invoicing' && form.assignedSalesmanIds.length > 0) {
        await Promise.all(form.assignedSalesmanIds.map((salesmanId) => assignInvoicingSalesman(result.id, salesmanId)));
      }
      await logAdminAction({
        action: 'Admin created a user account',
        targetTable: 'profiles',
        targetId: result.id,
        after: { role: form.role, displayName: form.displayName, email: form.email },
      });
      setToast(`${ROLE_LABELS[form.role]} account created successfully.`);
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (p) => {
    setExpandedId(p.id === expandedId ? null : p.id);
    setEditDraft({ display_name: p.display_name || '', sekolah: p.sekolah || '', status: p.status });
    setNewPassword('');
  };

  const saveEdit = async (p) => {
    const before = { display_name: p.display_name, sekolah: p.sekolah, status: p.status };
    try {
      await updateProfile(p.id, editDraft);
      await logAdminAction({ action: 'Admin updated a user account', targetTable: 'profiles', targetId: p.id, before, after: editDraft });
      setToast('User updated successfully.');
      setExpandedId(null);
      load();
    } catch (err) {
      setFormError(err.message);
    }
  };

  const handleDelete = async (p) => {
    if (!window.confirm(`Permanently delete ${p.display_name || p.email || 'this user'}? This can't be undone. If this account has order or activity history, deletion will be blocked — suspend it instead.`)) return;
    try {
      await deleteAccount(p.id);
      await logAdminAction({ action: 'Admin deleted a user account', targetTable: 'profiles', targetId: p.id, before: { display_name: p.display_name, email: p.email, role: p.role } });
      setToast('User deleted successfully.');
      setExpandedId(null);
      load();
    } catch (err) {
      setFormError(err.message);
    }
  };

  const handleToggleInvoicingSalesman = async (invoicingId, salesmanId, checked) => {
    try {
      if (checked) await assignInvoicingSalesman(invoicingId, salesmanId);
      else await unassignInvoicingSalesman(invoicingId, salesmanId);
      load();
    } catch (err) {
      setFormError(err.message);
    }
  };

  const handleResetPassword = async (p) => {
    if (newPassword.length < 6) {
      setFormError('New password must be at least 6 characters.');
      return;
    }
    try {
      await resetPassword(p.id, newPassword);
      await logAdminAction({ action: 'Admin changed a user password', targetTable: 'profiles', targetId: p.id });
      setToast('Password changed successfully.');
      setNewPassword('');
    } catch (err) {
      setFormError(err.message);
    }
  };

  return (
    <AdminLayout
      title="Users"
      subtitle="Manage every account in the system."
      headerActions={(
        <button
          type="button"
          onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}
          className="bg-primary text-on-primary text-label-bold font-semibold px-5 py-2.5 rounded-lg flex items-center gap-2 hover:opacity-90 transition-opacity whitespace-nowrap w-full sm:w-auto shadow-sm justify-center"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add User
        </button>
      )}
    >
      {toast && (
        <div className="mb-6 flex items-center gap-2 bg-secondary-container/40 text-on-secondary-container px-4 py-3 rounded-lg text-body-md">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toast}
        </div>
      )}
      {loadError && <div className="mb-6 bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md">{loadError}</div>}

      {showAddForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-6 mb-8">
          <h3 className="text-headline-sm text-on-surface mb-4">Add User</h3>

          <Field label="Role *" htmlFor="new-role">
            <select className={inputClass} id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </Field>

          {form.role === 'teacher' && (
            <Field label="School Name *" htmlFor="new-sekolah">
              <input className={inputClass} id="new-sekolah" placeholder="e.g. SMK Puchong" value={form.sekolah} onChange={(e) => setForm({ ...form, sekolah: e.target.value })} />
            </Field>
          )}

          {form.role !== 'teacher' && (
            <Field label="Name *" htmlFor="new-name">
              <input className={inputClass} id="new-name" placeholder="e.g. Mr. Lim" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>
          )}

          <Field label="Email *" htmlFor="new-email">
            <input className={inputClass} id="new-email" type="email" placeholder="e.g. teacher@school.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>

          <Field label="Password *" htmlFor="new-password">
            <input className={inputClass} id="new-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>

          {form.role === 'invoicing' && (
            <Field label="Assigned Salesmen" htmlFor="new-salesmen">
              <div id="new-salesmen" className="flex flex-col gap-2 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-3">
                {salesmenOptions.length === 0 ? (
                  <span className="text-body-sm text-on-surface-variant">No salesman accounts exist yet.</span>
                ) : (
                  salesmenOptions.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-body-md text-on-surface">
                      <input
                        type="checkbox"
                        checked={form.assignedSalesmanIds.includes(s.id)}
                        onChange={(e) => setForm({
                          ...form,
                          assignedSalesmanIds: e.target.checked
                            ? [...form.assignedSalesmanIds, s.id]
                            : form.assignedSalesmanIds.filter((id) => id !== s.id),
                        })}
                      />
                      {s.display_name || s.email}
                    </label>
                  ))
                )}
              </div>
            </Field>
          )}

          {formError && <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md mb-4">{formError}</div>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowAddForm(false)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2.5 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
              {saving ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant p-5 mb-8 flex flex-col md:flex-row gap-4">
        <div className="flex-1">
          <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="user-search">Search</label>
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
            <input className="w-full pl-10 pr-4 py-2 border border-outline-variant rounded-lg bg-surface-bright focus:ring-2 focus:ring-primary focus:border-primary text-body-md text-on-surface placeholder:text-outline-variant outline-none transition-all" id="user-search" placeholder="Search by name, email, or school..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="w-full md:w-48">
          <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="role-filter">Role</label>
          <select className={inputClass} id="role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">All Roles</option>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="w-full md:w-48">
          <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="status-filter">Status</label>
          <select className={inputClass} id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {profiles === null ? (
        <p className="text-body-md text-on-surface-variant">Loading users...</p>
      ) : filtered.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No users found. Try changing your search or filters.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-bright/50">
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Name</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Role</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Email</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">School</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider">Status</th>
                  <th className="text-label-bold text-on-surface-variant py-4 px-6 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-body-md text-on-surface divide-y divide-outline-variant">
                {filtered.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-surface-container-low transition-colors">
                      <td className="py-4 px-6 font-medium">{p.display_name || '—'}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{ROLE_LABELS[p.role] || p.role}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{p.email || '—'}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{p.sekolah || '—'}</td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-secondary-container/50 text-on-secondary-container text-label-bold font-semibold text-[10px] uppercase">{p.status}</span>
                      </td>
                      <td className="py-4 px-6 text-right">
                        <button type="button" onClick={() => startEdit(p)} className="text-label-bold font-semibold text-on-surface hover:text-primary transition-colors">{expandedId === p.id ? 'Close' : 'Edit'}</button>
                      </td>
                    </tr>
                    {expandedId === p.id && (
                      <tr className="bg-surface-container-lowest border-b-2 border-primary">
                        <td className="p-0" colSpan={6}>
                          <div className="p-6 md:p-8 bg-surface-container-lowest border-t border-outline-variant">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                              <div>
                                <label className="block text-label-bold text-on-surface-variant mb-1">Name</label>
                                <input className={inputClass} value={editDraft.display_name} onChange={(e) => setEditDraft({ ...editDraft, display_name: e.target.value })} />
                              </div>
                              {p.role === 'teacher' && (
                                <div>
                                  <label className="block text-label-bold text-on-surface-variant mb-1">School Name</label>
                                  <input className={inputClass} value={editDraft.sekolah} onChange={(e) => setEditDraft({ ...editDraft, sekolah: e.target.value })} />
                                </div>
                              )}
                              <div>
                                <label className="block text-label-bold text-on-surface-variant mb-1">Account Status</label>
                                <select className={inputClass} value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                                </select>
                              </div>
                            </div>
                            <button type="button" onClick={() => saveEdit(p)} className="bg-secondary text-on-secondary text-label-bold font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity shadow-sm mb-8">
                              Save Changes
                            </button>

                            {p.role === 'invoicing' && (
                              <div className="max-w-xl border-t border-outline-variant pt-6 mb-8">
                                <h4 className="text-label-bold text-on-surface-variant uppercase tracking-wider mb-4">Assigned Salesmen</h4>
                                {salesmenOptions.length === 0 ? (
                                  <span className="text-body-sm text-on-surface-variant">No salesman accounts exist yet.</span>
                                ) : (
                                  <div className="flex flex-col gap-2 max-h-48 overflow-y-auto border border-outline-variant rounded-lg p-3">
                                    {salesmenOptions.map((s) => {
                                      const checked = invoicingAssignments.some((a) => a.invoicing_id === p.id && a.salesman_id === s.id);
                                      return (
                                        <label key={s.id} className="flex items-center gap-2 text-body-md text-on-surface">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={(e) => handleToggleInvoicingSalesman(p.id, s.id, e.target.checked)}
                                          />
                                          {s.display_name || s.email}
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className="max-w-xl border-t border-outline-variant pt-6">
                              <h4 className="text-label-bold text-on-surface-variant uppercase tracking-wider mb-4">Change Password</h4>
                              <div className="flex flex-col sm:flex-row gap-4 items-end">
                                <div className="flex-1 w-full">
                                  <label className="block text-label-bold text-on-surface-variant mb-1">New Password</label>
                                  <input className={inputClass} placeholder="At least 6 characters" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                                </div>
                                <button type="button" onClick={() => handleResetPassword(p)} className="bg-surface-container text-on-surface text-label-bold font-semibold px-5 py-2.5 rounded-lg border border-outline-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap w-full sm:w-auto">
                                  Change Password
                                </button>
                              </div>
                            </div>

                            <div className="max-w-xl border-t border-outline-variant pt-6 mt-6">
                              <h4 className="text-label-bold text-error uppercase tracking-wider mb-2">Danger Zone</h4>
                              {p.id === state.userAuthId ? (
                                <p className="text-body-sm text-on-surface-variant">You can't delete your own account.</p>
                              ) : (
                                <>
                                  <p className="text-body-sm text-on-surface-variant mb-3">Permanently deletes this account and its login. Blocked if the account has order or activity history — suspend it instead in that case.</p>
                                  <button type="button" onClick={() => handleDelete(p)} className="bg-error-container text-on-error-container text-label-bold font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity">
                                    Delete Account
                                  </button>
                                </>
                              )}
                            </div>
                            {formError && <div className="mt-4 bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md">{formError}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
