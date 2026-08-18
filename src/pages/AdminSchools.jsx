import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles, fetchSalesmanAssignments, createAccount, logAdminAction } from '../lib/adminApi';

const EMPTY_FORM = { sekolah: '', address: '', displayName: '', email: '', password: '', assignedSalesmanId: '' };

function Field({ label, htmlFor, children }) {
  return (
    <div className="mb-4">
      <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

const inputClass = 'w-full px-3 py-2 border border-outline-variant rounded-lg bg-surface-bright focus:ring-2 focus:ring-primary focus:border-primary text-body-md text-on-surface outline-none transition-all';

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
        address: form.address.trim() || null,
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        password: form.password,
        assignedSalesmanId: form.assignedSalesmanId || null,
      });
      await logAdminAction({
        action: 'Admin created a school account',
        targetTable: 'profiles',
        targetId: result.id,
        after: { sekolah: form.sekolah, address: form.address, displayName: form.displayName, email: form.email },
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
    <AdminLayout
      title="Schools"
      subtitle="All schools registered in the system."
      headerActions={(
        <button
          type="button"
          onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}
          className="bg-primary text-on-primary text-headline-sm px-6 py-3 rounded-lg hover:bg-primary/90 transition-colors shadow-sm hover:shadow-md flex items-center gap-2 w-full md:w-auto justify-center"
        >
          <span className="material-symbols-outlined text-[20px]">add</span>
          Add School
        </button>
      )}
    >
      {toast && (
        <div className="mb-6 flex items-center gap-2 bg-secondary-container/40 text-on-secondary-container px-4 py-3 rounded-lg text-body-md">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          {toast}
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleCreate} className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-6 mb-10">
          <h3 className="text-headline-sm text-on-surface mb-4">Add School</h3>
          <Field label="School Name *" htmlFor="school-name">
            <input className={inputClass} id="school-name" placeholder="e.g. SMK Puchong" value={form.sekolah} onChange={(e) => setForm({ ...form, sekolah: e.target.value })} />
          </Field>
          <Field label="School Address" htmlFor="school-address">
            <input className={inputClass} id="school-address" placeholder="e.g. Jalan Puchong, 47100 Puchong, Selangor" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Teacher Name *" htmlFor="teacher-name">
            <input className={inputClass} id="teacher-name" placeholder="e.g. Mr. Lim" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Teacher Email *" htmlFor="teacher-email">
            <input className={inputClass} id="teacher-email" type="email" placeholder="e.g. teacher@school.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password *" htmlFor="teacher-password">
            <input className={inputClass} id="teacher-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Assigned Salesman" htmlFor="assigned-salesman">
            <select className={inputClass} id="assigned-salesman" value={form.assignedSalesmanId} onChange={(e) => setForm({ ...form, assignedSalesmanId: e.target.value })}>
              <option value="">None</option>
              {salesmenOptions.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.email}</option>)}
            </select>
          </Field>
          {formError && <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md mb-4">{formError}</div>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowAddForm(false)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2.5 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
              {saving ? 'Creating...' : 'Create School'}
            </button>
          </div>
        </form>
      )}

      <div className="w-full max-w-md mb-6">
        <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="school-search">Search</label>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
          <input className="w-full pl-10 pr-4 py-2.5 bg-surface rounded-lg border border-outline-variant focus:border-primary focus:ring-1 focus:ring-primary text-body-md placeholder:text-outline/70 transition-colors" id="school-search" placeholder="Search schools..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {profiles === null ? (
        <p className="text-body-md text-on-surface-variant">Loading schools...</p>
      ) : filtered.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No schools found. Try changing your search.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-xl shadow-sm border border-outline-variant overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface border-b border-outline-variant">
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">School</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Teacher</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Salesman</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Orders</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant text-body-md text-on-surface">
                {filtered.map((s) => {
                  const schoolSalesmen = assignments
                    .filter((a) => a.teacher_id === s.id)
                    .map((a) => salesmenById.get(a.salesman_id))
                    .filter(Boolean);
                  const orderCount = (state.orders || []).filter((o) => o.createdBy === s.id).length;
                  return (
                    <tr key={s.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="py-4 px-6 text-headline-sm">{s.sekolah || '—'}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{s.display_name || '—'}</td>
                      <td className="py-4 px-6 text-on-surface-variant">{schoolSalesmen.length > 0 ? schoolSalesmen.map((sm) => sm.display_name || sm.email).join(', ') : '—'}</td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-secondary-container text-on-secondary-container">{s.status}</span>
                      </td>
                      <td className="py-4 px-6">{orderCount}</td>
                      <td className="py-4 px-6 text-right">
                        <button type="button" onClick={() => navigate(`/admin/schools/${s.id}`)} className="text-primary hover:text-primary-container text-headline-sm underline decoration-primary/30 underline-offset-4 hover:decoration-primary transition-all">View</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
