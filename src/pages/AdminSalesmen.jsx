import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles, fetchSalesmanAssignments, createAccount, logAdminAction } from '../lib/adminApi';

const EMPTY_FORM = { displayName: '', email: '', password: '' };

export default function AdminSalesmen() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState(null);
  const [assignments, setAssignments] = useState([]);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    Promise.all([fetchAllProfiles(), fetchSalesmanAssignments()])
      .then(([p, a]) => { setProfiles(p); setAssignments(a); })
      .catch((err) => console.error('Failed to load salesmen:', err));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const salesmen = (profiles || []).filter((p) => p.role === 'salesman');

  const filtered = salesmen.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [s.display_name, s.email].some((v) => (v || '').toLowerCase().includes(q));
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.displayName.trim() || !form.email.trim() || !form.password) {
      setFormError('Name, Email, and Password are required.');
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
    setSaving(true);
    try {
      const result = await createAccount({
        role: 'salesman',
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      await logAdminAction({
        action: 'Admin created a salesman account',
        targetTable: 'profiles',
        targetId: result.id,
        after: { displayName: form.displayName, email: form.email },
      });
      setToast('Salesman account created successfully.');
      setForm(EMPTY_FORM);
      setShowAddForm(false);
      load();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="screen-wrap">
      <Nav />

      <div className="dashboard-header">
        <div>
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Salesmen</div>
          <p className="hint-text" style={{ margin: 0 }}>All salesmen and the schools assigned to them.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}>+ Add Salesman</button>
      </div>

      {toast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {toast}
        </div>
      )}

      {showAddForm && (
        <form className="card" style={{ marginBottom: 'var(--space-6)' }} onSubmit={handleCreate}>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>Add Salesman</div>
          <div className="field">
            <label htmlFor="sales-name">Name *</label>
            <input className="input" id="sales-name" placeholder="e.g. Sean" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sales-email">Email *</label>
            <input className="input" id="sales-email" type="email" placeholder="e.g. sean@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="sales-password">Password *</label>
            <input className="input" id="sales-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          {formError && <div className="login-error" style={{ marginBottom: 'var(--space-4)' }}>{formError}</div>}
          <div className="row-split">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create Salesman'}</button>
          </div>
        </form>
      )}

      <div className="field" style={{ maxWidth: 400 }}>
        <label htmlFor="sales-search">Search</label>
        <input className="input" id="sales-search" placeholder="Search salesmen..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {profiles === null ? (
        <p className="hint-text">Loading salesmen...</p>
      ) : filtered.length === 0 ? (
        <p className="hint-text">No salesmen found. Try changing your search.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Status</th><th>Schools</th><th>Total Orders</th><th>Pending</th><th>Completed</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const teacherIds = assignments.filter((a) => a.salesman_id === s.id).map((a) => a.teacher_id);
                const salesmanOrders = (state.orders || []).filter((o) => teacherIds.includes(o.createdBy));
                const pending = salesmanOrders.filter((o) => o.status === 'Submitted to Sales').length;
                const completed = salesmanOrders.filter((o) => o.status === 'Completed').length;
                return (
                  <tr key={s.id}>
                    <td>{s.display_name || '—'}</td>
                    <td>{s.email || '—'}</td>
                    <td><span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }}>{s.status}</span></td>
                    <td>{teacherIds.length}</td>
                    <td>{salesmanOrders.length}</td>
                    <td>{pending}</td>
                    <td>{completed}</td>
                    <td><button type="button" className="btn btn-ghost" onClick={() => navigate(`/admin/salesmen/${s.id}`)}>View</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
