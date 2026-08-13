import { Fragment, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import { fetchAllProfiles, createAccount, updateProfile, resetPassword, logAdminAction } from '../lib/adminApi';

const ROLE_LABELS = { teacher: 'School', salesman: 'Salesman', production: 'Production', admin: 'Admin' };
const ROLE_OPTIONS = Object.keys(ROLE_LABELS);
const STATUS_OPTIONS = ['active', 'inactive', 'suspended'];

const EMPTY_FORM = { role: 'teacher', sekolah: '', displayName: '', email: '', password: '', assignedSalesmanId: '' };

export default function AdminUsers() {
  const [profiles, setProfiles] = useState(null);
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
    fetchAllProfiles()
      .then(setProfiles)
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
    if (!form.email.trim() || !form.password || !form.displayName.trim()) {
      setFormError('Name, email, and password are required.');
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
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
        assignedSalesmanId: form.assignedSalesmanId || null,
      });
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
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Users</div>
          <p className="hint-text" style={{ margin: 0 }}>Manage every account in the system.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}>+ Add User</button>
      </div>

      {toast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {toast}
        </div>
      )}
      {loadError && <div className="login-error">{loadError}</div>}

      {showAddForm && (
        <form className="card" style={{ marginBottom: 'var(--space-6)' }} onSubmit={handleCreate}>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>Add User</div>

          <div className="field">
            <label htmlFor="new-role">Role *</label>
            <select className="input" id="new-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          {form.role === 'teacher' && (
            <div className="field">
              <label htmlFor="new-sekolah">School Name *</label>
              <input className="input" id="new-sekolah" placeholder="e.g. SMK Puchong" value={form.sekolah} onChange={(e) => setForm({ ...form, sekolah: e.target.value })} />
            </div>
          )}

          <div className="field">
            <label htmlFor="new-name">{form.role === 'teacher' ? 'Teacher Name' : 'Name'} *</label>
            <input className="input" id="new-name" placeholder="e.g. Mr. Lim" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="new-email">Email *</label>
            <input className="input" id="new-email" type="email" placeholder="e.g. teacher@school.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>

          <div className="field">
            <label htmlFor="new-password">Password *</label>
            <input className="input" id="new-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>

          {form.role === 'teacher' && (
            <div className="field">
              <label htmlFor="new-salesman">Assigned Salesman</label>
              <select className="input" id="new-salesman" value={form.assignedSalesmanId} onChange={(e) => setForm({ ...form, assignedSalesmanId: e.target.value })}>
                <option value="">None</option>
                {salesmenOptions.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.email}</option>)}
              </select>
            </div>
          )}

          {formError && <div className="login-error" style={{ marginBottom: 'var(--space-4)' }}>{formError}</div>}

          <div className="row-split">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create User'}</button>
          </div>
        </form>
      )}

      <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="user-search">Search</label>
          <input className="input" id="user-search" placeholder="Search by name, email, or school..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="role-filter">Role</label>
          <select className="input" id="role-filter" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">All Roles</option>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="status-filter">Status</label>
          <select className="input" id="status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {profiles === null ? (
        <p className="hint-text">Loading users...</p>
      ) : filtered.length === 0 ? (
        <p className="hint-text">No users found. Try changing your search or filters.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Role</th><th>Email</th><th>School</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <Fragment key={p.id}>
                  <tr>
                    <td>{p.display_name || '—'}</td>
                    <td>{ROLE_LABELS[p.role] || p.role}</td>
                    <td>{p.email || '—'}</td>
                    <td>{p.sekolah || '—'}</td>
                    <td><span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }}>{p.status}</span></td>
                    <td><button type="button" className="btn btn-ghost" onClick={() => startEdit(p)}>{expandedId === p.id ? 'Close' : 'Edit'}</button></td>
                  </tr>
                  {expandedId === p.id && (
                    <tr>
                      <td colSpan={6}>
                        <div className="form-grid-2">
                          <div className="field">
                            <label>Name</label>
                            <input className="input" value={editDraft.display_name} onChange={(e) => setEditDraft({ ...editDraft, display_name: e.target.value })} />
                          </div>
                          {p.role === 'teacher' && (
                            <div className="field">
                              <label>School Name</label>
                              <input className="input" value={editDraft.sekolah} onChange={(e) => setEditDraft({ ...editDraft, sekolah: e.target.value })} />
                            </div>
                          )}
                          <div className="field">
                            <label>Account Status</label>
                            <select className="input" value={editDraft.status} onChange={(e) => setEditDraft({ ...editDraft, status: e.target.value })}>
                              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                            </select>
                          </div>
                        </div>
                        <button type="button" className="btn btn-primary" style={{ marginBottom: 'var(--space-6)' }} onClick={() => saveEdit(p)}>Save Changes</button>

                        <div className="card-kicker">Change Password</div>
                        <div className="form-grid-2" style={{ gridTemplateColumns: '2fr 1fr' }}>
                          <div className="field">
                            <label>New Password</label>
                            <input className="input" type="password" placeholder="At least 6 characters" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                          </div>
                          <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                            <button type="button" className="btn btn-secondary" onClick={() => handleResetPassword(p)}>Change Password</button>
                          </div>
                        </div>
                        {formError && <div className="login-error">{formError}</div>}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
