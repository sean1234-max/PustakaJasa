import { useState } from 'react';
import { createAccount } from '../lib/adminApi';

const inputClass = 'w-full px-3 py-2 border border-outline-variant rounded-lg bg-surface-bright focus:ring-2 focus:ring-primary focus:border-primary text-body-md text-on-surface outline-none transition-all';

// School Name -> login email, matching the convention already used for the
// school accounts created before this (SK PUCHONG -> skpuchong@pjsb.com,
// SMK Jalan Reko -> smkjalanreko@pjsb.com): lowercase, strip everything but
// letters/digits, so a whole list of school names needs no per-row email.
export function schoolEmailFromName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${slug}@pjsb.com`;
}

const lines = (text) => [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))];

// Bulk Add Schools — one School (teacher) account per line, same createAccount() the single Add User form
// uses, just looped. Sequential (not Promise.all) so a duplicate-email failure on one row can't race another
// row's insert, and so "Creating X of Y" tracks real progress. Used by Admin Users and the Sales dashboard
// (Sean 2026-11-12); admin-user-ops lets a salesman create School accounts only and writes his audit row.
// onCreated(result, { name, email }) runs per created school (Admin writes its own audit row there).
export default function BulkAddSchoolsForm({ onClose, onCreated, onDone }) {
  const [names, setNames] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResults(null);
    const list = lines(names);
    if (list.length === 0) {
      setError('Enter at least one school name, one per line.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    const out = [];
    for (let i = 0; i < list.length; i += 1) {
      const name = list[i];
      const email = schoolEmailFromName(name);
      setProgress({ done: i, total: list.length });
      try {
        const result = await createAccount({ role: 'teacher', sekolah: name, displayName: `Cikgu ${name}`, email, password });
        if (onCreated) await onCreated(result, { name, email });
        out.push({ name, email, ok: true });
      } catch (err) {
        out.push({ name, email, ok: false, error: err.message });
      }
    }
    setProgress(null);
    setResults(out);
    setBusy(false);
    if (onDone) onDone(out);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-surface-container-lowest border border-outline-variant rounded-xl shadow-sm p-6 mb-8">
      <h3 className="text-headline-sm text-on-surface mb-1">Bulk Add Schools</h3>
      <p className="text-body-sm text-on-surface-variant mb-4">
        One school per line. Each becomes a School (teacher) account with the same login password below — email is generated as the school name lowercased with spaces/symbols removed, e.g. &quot;SK PUCHONG&quot; → skpuchong@pjsb.com.
      </p>

      <div className="mb-4">
        <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="bulk-names">{`School Names * (${lines(names).length} lines)`}</label>
        <textarea className={inputClass} id="bulk-names" rows={8} placeholder={'SK PUCHONG\nSK BUKIT LANJAN\n...'} value={names} onChange={(e) => setNames(e.target.value)} />
      </div>

      <div className="mb-4">
        <label className="block text-label-bold text-on-surface-variant mb-1" htmlFor="bulk-password">Password for all *</label>
        <input className={inputClass} id="bulk-password" type="text" placeholder="At least 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>

      {error && <div className="bg-error-container text-on-error-container px-4 py-3 rounded-lg text-body-md mb-4">{error}</div>}
      {progress && <p className="text-body-sm text-on-surface-variant mb-4">Creating {progress.done + 1} of {progress.total}…</p>}

      {results && (
        <div className="mb-4 border border-outline-variant rounded-lg overflow-hidden">
          <table className="w-full text-body-sm">
            <thead className="bg-surface-container text-on-surface-variant">
              <tr><th className="text-left px-3 py-2">School</th><th className="text-left px-3 py-2">Email</th><th className="text-left px-3 py-2">Result</th></tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.email} className="border-t border-outline-variant">
                  <td className="px-3 py-2">{r.name}</td>
                  <td className="px-3 py-2">{r.email}</td>
                  <td className={`px-3 py-2 ${r.ok ? 'text-on-surface-variant' : 'text-error'}`}>{r.ok ? '✓ Created' : `✗ ${r.error}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} className="text-label-bold font-semibold text-on-surface hover:text-primary px-4 py-2.5 rounded-lg">Close</button>
        <button type="submit" disabled={busy} className="bg-primary text-on-primary text-label-bold font-semibold px-6 py-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-60">
          {busy ? 'Creating…' : 'Create All'}
        </button>
      </div>
    </form>
  );
}
