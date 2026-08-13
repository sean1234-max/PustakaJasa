import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles, fetchSalesmanAssignments, createAccount, logAdminAction } from '../lib/adminApi';

const EMPTY_FORM = { sekolah: '', displayName: '', email: '', password: '', assignedSalesmanId: '' };

export default function AdminSchools() {
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
      .catch((err) => console.error('Failed to load schools:', err));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const salesmenById = new Map((profiles || []).filter((p) => p.role === 'salesman').map((p) => [p.id, p]));
  const schools = (profiles || []).filter((p) => p.role === 'teacher');
  const salesmenOptions = (profiles || []).filter((p) => p.role === 'salesman');

  const filtered = schools.filter((s) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [s.sekolah, s.display_name, s.email].some((v) => (v || '').toLowerCase().includes(q));
  });

  const handleCreate = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.sekolah.trim() || !form.displayName.trim() || !form.email.trim() || !form.password) {
      setFormError('School Name, Teacher Name, Email, and Password are required.');
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
        role: 'teacher',
        sekolah: form.sekolah.trim(),
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
        assignedSalesmanId: form.assignedSalesmanId || null,
      });
      await logAdminAction({
        action: 'Admin created a school account',
        targetTable: 'profiles',
        targetId: result.id,
        after: { sekolah: form.sekolah, displayName: form.displayName, email: form.email },
      });
      setToast('School account created successfully.');
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
          <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Schools</div>
          <p className="hint-text" style={{ margin: 0 }}>All schools registered in the system.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}>+ Add School</button>
      </div>

      {toast && (
        <div className="update-toast">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          {toast}
        </div>
      )}

      {showAddForm && (
        <form className="card" style={{ marginBottom: 'var(--space-6)' }} onSubmit={handleCreate}>
          <div className="card-kicker" style={{ marginBottom: 'var(--space-3)' }}>Add School</div>
          <div className="field">
            <label htmlFor="school-name">School Name *</label>
            <input className="input" id="school-name" placeholder="e.g. SMK Puchong" value={form.sekolah} onChange={(e) => setForm({ ...form, sekolah: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="teacher-name">Teacher Name *</label>
            <input className="input" id="teacher-name" placeholder="e.g. Mr. Lim" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="teacher-email">Teacher Email *</label>
            <input className="input" id="teacher-email" type="email" placeholder="e.g. teacher@school.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="teacher-password">Password *</label>
            <input className="input" id="teacher-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="assigned-salesman">Assigned Salesman</label>
            <select className="input" id="assigned-salesman" value={form.assignedSalesmanId} onChange={(e) => setForm({ ...form, assignedSalesmanId: e.target.value })}>
              <option value="">None</option>
              {salesmenOptions.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.email}</option>)}
            </select>
          </div>
          {formError && <div className="login-error" style={{ marginBottom: 'var(--space-4)' }}>{formError}</div>}
          <div className="row-split">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating...' : 'Create School'}</button>
          </div>
        </form>
      )}

      <div className="field" style={{ maxWidth: 400 }}>
        <label htmlFor="school-search">Search</label>
        <input className="input" id="school-search" placeholder="Search schools..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {profiles === null ? (
        <p className="hint-text">Loading schools...</p>
      ) : filtered.length === 0 ? (
        <p className="hint-text">No schools found. Try changing your search.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>School</th><th>Teacher</th><th>Salesman</th><th>Status</th><th>Orders</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const assignment = assignments.find((a) => a.teacher_id === s.id);
                const salesman = assignment ? salesmenById.get(assignment.salesman_id) : null;
                const orderCount = (state.orders || []).filter((o) => o.createdBy === s.id).length;
                return (
                  <tr key={s.id}>
                    <td>{s.sekolah || '—'}</td>
                    <td>{s.display_name || '—'}</td>
                    <td>{salesman ? (salesman.display_name || salesman.email) : '—'}</td>
                    <td><span className="status-pill" style={{ background: 'var(--color-accent-100)', color: 'var(--color-accent-900)' }}>{s.status}</span></td>
                    <td>{orderCount}</td>
                    <td><button type="button" className="btn btn-ghost" onClick={() => navigate(`/admin/schools/${s.id}`)}>View</button></td>
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
