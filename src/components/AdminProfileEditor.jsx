import { useState } from 'react';
import { updateProfile, updateUserEmail, logAdminAction } from '../lib/adminApi';

const inputClass = 'w-full rounded-lg border border-outline-variant bg-surface-container-lowest text-on-surface focus:ring-2 focus:ring-primary focus:border-primary py-2.5 px-4 shadow-sm outline-none transition-all text-body-md';

// Name + login-email editor for any account, on every admin detail page
// (Salesman / Store Admin / School) and the Users list's inline editor.
// Name is a plain profiles UPDATE; email goes through the admin-user-ops
// Edge Function (updateUserEmail) since it also changes auth.users. Either
// field can be left unchanged — only what actually differs is written.
export default function AdminProfileEditor({ profile, onSaved, setToast, setError, heading = 'Name & Email' }) {
  const [name, setName] = useState(profile.display_name || '');
  const [email, setEmail] = useState(profile.email || '');
  const [saving, setSaving] = useState(false);

  const origName = profile.display_name || '';
  const origEmail = profile.email || '';
  const dirty = name.trim() !== origName || email.trim() !== origEmail;

  const save = async () => {
    if (saving) return;
    const newName = name.trim();
    const newEmail = email.trim();
    if (!newName) { setError('Name cannot be empty.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(newEmail)) { setError('Please enter a valid email address.'); return; }
    setSaving(true);
    setError('');
    try {
      if (newName !== origName) await updateProfile(profile.id, { display_name: newName });
      if (newEmail !== origEmail) await updateUserEmail(profile.id, newEmail);
      await logAdminAction({
        action: 'Admin updated a user profile',
        targetTable: 'profiles',
        targetId: profile.id,
        before: { display_name: origName, email: origEmail },
        after: { display_name: newName, email: newEmail },
      });
      setToast('Profile updated.');
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-label-bold text-secondary uppercase tracking-wider">{heading}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <div>
          <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor={`pe-name-${profile.id}`}>Name</label>
          <input id={`pe-name-${profile.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor={`pe-email-${profile.id}`}>Email (login)</label>
          <input id={`pe-email-${profile.id}`} type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="w-full sm:w-auto bg-secondary text-on-secondary text-label-bold font-semibold px-5 py-2.5 rounded-lg hover:opacity-90 transition-opacity shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </section>
  );
}
