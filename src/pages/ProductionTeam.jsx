import { useEffect, useMemo, useState } from 'react';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { fetchAllSalesmen } from '../lib/ordersApi';
import { createAccount } from '../lib/adminApi';
import { fetchProductionAccounts, fetchProductionAssignments, setProductionAssignment } from '../lib/productionTeamApi';

// The production manager's page (Sean, 2026-10-06; migration 0080): which
// production account works which salesman's orders, and new production
// accounts. Every other production account only sees its own salesmen's
// orders; a salesman left on "Manager only" is seen by the manager alone.
export default function ProductionTeam() {
  const { state } = useAppState();
  const [accounts, setAccounts] = useState(null);
  const [salesmen, setSalesmen] = useState([]);
  const [assigned, setAssigned] = useState({}); // salesmanId → productionId
  const [message, setMessage] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [creating, setCreating] = useState(false);

  const load = () => Promise.all([fetchProductionAccounts(), fetchAllSalesmen(), fetchProductionAssignments()])
    .then(([acc, sm, asg]) => {
      setAccounts(acc);
      setSalesmen([...sm].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
      setAssigned(Object.fromEntries(asg.map((a) => [a.salesman_id, a.production_id])));
    })
    .catch((err) => {
      console.error('Failed to load the production team:', err);
      setMessage({ ok: false, text: 'Could not load the team. Check your connection and refresh.' });
    });
  useEffect(() => { if (state.isProductionManager) load(); }, [state.isProductionManager]);

  const workers = useMemo(() => (accounts || []).filter((a) => !a.is_production_manager), [accounts]);
  const nameOf = (a) => a.display_name || a.email;

  if (!state.isProductionManager) {
    return (
      <div className="screen-wrap">
        <Nav />
        <div className="card elev-md"><p className="hint-text">Only the Production manager can manage the team.</p></div>
      </div>
    );
  }

  const handleAssign = async (salesmanId, productionId) => {
    setSavingId(salesmanId);
    try {
      await setProductionAssignment(salesmanId, productionId || null);
      setAssigned((prev) => ({ ...prev, [salesmanId]: productionId || undefined }));
      setMessage(null);
    } catch (err) {
      console.error('Failed to assign salesman:', err);
      setMessage({ ok: false, text: 'Could not save that change. Please try again.' });
    }
    setSavingId(null);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const email = form.email.trim();
    if (!form.displayName.trim() || !email || form.password.length < 6) {
      setMessage({ ok: false, text: 'Enter a name, an email and a password of at least 6 characters.' });
      return;
    }
    setCreating(true);
    try {
      await createAccount({ role: 'production', displayName: form.displayName.trim(), email, password: form.password });
      setForm({ displayName: '', email: '', password: '' });
      setMessage({ ok: true, text: `Created ${email}. Assign salesmen to it below.` });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err.message || 'Could not create the account.' });
    }
    setCreating(false);
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Production</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Team</div>
        <p className="hint-text">
          Each production account sees only the orders of the salesmen assigned to it. A salesman on “Manager only” is seen by you alone.
        </p>
        {message && <p className="hint-text" style={{ color: message.ok ? '#1f8a3b' : '#c0392b', fontWeight: 600 }}>{message.text}</p>}

        {accounts === null ? (
          <p className="hint-text">Loading…</p>
        ) : (
          <>
            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Who works each salesman’s orders</div>
            <table className="table">
              <thead>
                <tr><th>Salesman</th><th>Production account</th></tr>
              </thead>
              <tbody>
                {salesmen.map((sm) => (
                  <tr key={sm.id}>
                    <td>{sm.name || 'Unnamed salesman'}</td>
                    <td>
                      <select
                        className="input"
                        value={assigned[sm.id] || ''}
                        disabled={savingId === sm.id}
                        onChange={(e) => handleAssign(sm.id, e.target.value)}
                      >
                        <option value="">Manager only</option>
                        {workers.map((w) => <option key={w.id} value={w.id}>{nameOf(w)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>Production accounts</div>
            {workers.length === 0 && <p className="hint-text">None yet — create one below.</p>}
            {workers.map((w) => {
              const mine = salesmen.filter((sm) => assigned[sm.id] === w.id).map((sm) => sm.name);
              return (
                <p key={w.id} className="hint-text" style={{ margin: '0 0 var(--space-2)' }}>
                  <strong>{nameOf(w)}</strong> ({w.email}{w.status !== 'active' ? `, ${w.status}` : ''}) — {mine.length ? mine.join(', ') : 'no salesmen yet'}
                </p>
              );
            })}

            <div className="card-kicker" style={{ marginTop: 'var(--space-6)' }}>New production account</div>
            <form onSubmit={handleCreate} className="form-grid-2" style={{ marginTop: 'var(--space-3)' }}>
              <div className="field">
                <label htmlFor="teamName">Name</label>
                <input className="input" id="teamName" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="teamEmail">Email (login ID)</label>
                <input className="input" id="teamEmail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="teamPassword">Password</label>
                <input className="input" id="teamPassword" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="field" style={{ alignSelf: 'end' }}>
                <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create account'}</button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
