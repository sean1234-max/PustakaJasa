import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from '../components/AdminLayout';
import { useAppState } from '../state/useAppState';
import { fetchAllProfiles, createAccount, logAdminAction } from '../lib/adminApi';

const EMPTY_FORM = { displayName: '', email: '', password: '' };
const inputClass = 'w-full px-3 py-2 border border-outline-variant rounded-lg bg-surface-bright focus:ring-2 focus:ring-primary focus:border-primary text-body-md text-on-surface outline-none transition-all';

function Field({ label, htmlFor, children }) {
  return (
    <div className="mb-4">
      <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

export default function AdminSalesmen() {
  const { state } = useAppState();
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState(null);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const load = () => {
    fetchAllProfiles()
      .then(setProfiles)
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
    <AdminLayout
      title="Salesmen"
      subtitle="All salesmen in the system."
      headerActions={(
        <button
          type="button"
          onClick={() => { setShowAddForm((v) => !v); setFormError(''); }}
          className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors w-full md:w-auto"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Salesman
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
          <h3 className="text-headline-sm text-on-surface mb-4">Add Salesman</h3>
          <Field label="Name *" htmlFor="sales-name">
            <input className={inputClass} id="sales-name" placeholder="e.g. Sean" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="Email *" htmlFor="sales-email">
            <input className={inputClass} id="sales-email" type="email" placeholder="e.g. sean@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Password *" htmlFor="sales-password">
            <input className={inputClass} id="sales-password" type="password" placeholder="At least 6 characters" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          {formError && <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md mb-4">{formError}</div>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setShowAddForm(false)} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2.5 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
              {saving ? 'Creating...' : 'Create Salesman'}
            </button>
          </div>
        </form>
      )}

      <div className="w-full max-w-md mb-6">
        <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="sales-search">Search</label>
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline">search</span>
          <input className="w-full pl-10 pr-4 py-2 border border-outline-variant rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all text-body-md text-on-surface" id="sales-search" placeholder="Search salesmen..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {profiles === null ? (
        <p className="text-body-md text-on-surface-variant">Loading salesmen...</p>
      ) : filtered.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No salesmen found. Try changing your search.</p>
      ) : (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-bright">
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Name</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Email</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Total Orders</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Pending</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider">Completed</th>
                  <th className="py-4 px-6 text-label-bold text-on-surface-variant uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {filtered.map((s) => {
                  const salesmanOrders = (state.orders || []).filter((o) => o.salesmanId === s.id);
                  const pending = salesmanOrders.filter((o) => o.status === 'Submitted to Sales').length;
                  const completed = salesmanOrders.filter((o) => o.status === 'Completed').length;
                  return (
                    <tr key={s.id} className="hover:bg-surface-container-low transition-colors">
                      <td className="py-4 px-6 text-headline-sm text-primary">{s.display_name || '—'}</td>
                      <td className="py-4 px-6 text-body-md text-on-surface-variant">{s.email || '—'}</td>
                      <td className="py-4 px-6">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-label-bold font-semibold bg-primary-container/15 text-primary">{s.status}</span>
                      </td>
                      <td className="py-4 px-6 text-body-md text-on-surface">{salesmanOrders.length}</td>
                      <td className="py-4 px-6 text-body-md text-on-surface">{pending}</td>
                      <td className="py-4 px-6 text-body-md text-on-surface">{completed}</td>
                      <td className="py-4 px-6 text-right">
                        <button type="button" onClick={() => navigate(`/admin/salesmen/${s.id}`)} className="text-label-bold font-semibold text-primary hover:text-primary-container transition-colors">View</button>
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
