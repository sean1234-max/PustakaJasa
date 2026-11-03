import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Nav from '../components/Nav';
import { useAppState } from '../state/useAppState';
import { fetchReviewLog, saveReviewNote } from '../lib/reviewLogApi';
import { reviewChanges, aiOutcomes } from '../utils/reviewLog';
import { formatDateTime } from '../data/catalog';

// Review Log (Sean, 2026-11-04 — the AI review's shadow period, docs/ai-review-rules.md): every order
// reviewed, what Production changed and what AI Review flagged, side by side. Where they differ
// (a change with no flag = AI missed it; a flag nothing changed for = maybe a false alarm), Sean
// writes why in a sentence — those sentences become new rules.
const OUTCOME = {
  changed: { label: '✓ acted on', color: '#2f6b4f' },
  kept: { label: '✗ not changed', color: '#b45309' },
  unknown: { label: '· check by hand', color: '#666' },
};

function Changes({ changes }) {
  if (!changes.length) return <p className="hint-text">Nothing changed while reviewing.</p>;
  return changes.map((c) => (
    <div key={c.sheet} style={{ marginBottom: 'var(--space-2)' }}>
      <div style={{ fontWeight: 600 }}>📍 {c.sheet}</div>
      {c.removed.map((p) => <div key={`r-${p.text}`} style={{ color: '#b0392e' }}>− {p.text}{p.count > 1 ? ` (×${p.count})` : ''}</div>)}
      {c.added.map((p) => <div key={`a-${p.text}`} style={{ color: '#2f6b4f' }}>+ {p.text}{p.count > 1 ? ` (×${p.count})` : ''}</div>)}
    </div>
  ));
}

function LogEntry({ entry }) {
  const changes = useMemo(() => reviewChanges(entry.original_items, entry.done_items), [entry]);
  const flags = useMemo(() => aiOutcomes(entry.ai_issues, entry.done_items), [entry]);
  const [note, setNote] = useState(entry.note || '');
  const [saved, setSaved] = useState('');
  const missedSomething = changes.length > 0 && !flags.some((f) => f.outcome === 'changed');
  const save = async () => {
    try {
      await saveReviewNote(entry.order_id, note);
      setSaved('Saved.');
    } catch (err) {
      console.error('Could not save the review note:', err);
      setSaved('Could not save — please try again.');
    }
  };
  return (
    <div className="card elev-md" style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Link to={`/production/orders/${entry.order_id}`} style={{ fontWeight: 700 }}>{entry.order_id}</Link>
        <span className="hint-text">Done Review {formatDateTime(entry.done_at)}{entry.done_by_name ? ` · ${entry.done_by_name}` : ''}</span>
      </div>
      {missedSomething && <p style={{ margin: '6px 0', fontWeight: 600, color: '#b45309' }}>⚠ Changed by hand but AI Review flagged none of it — what did it miss?</p>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
        <div>
          <div className="card-kicker">What you changed</div>
          <Changes changes={changes} />
        </div>
        <div>
          <div className="card-kicker">What AI Review flagged</div>
          {flags.length === 0 && <p className="hint-text">Nothing flagged{entry.ai_at ? '' : ' (AI Review was not opened)'}.</p>}
          {flags.map((f) => (
            <div key={`${f.rule}-${f.text}`} style={{ marginBottom: 4 }}>
              <span style={{ color: OUTCOME[f.outcome].color, fontWeight: 600 }}>{OUTCOME[f.outcome].label}</span>
              {' '}[{f.rule}]{f.ai ? ' 🤖' : ''} {f.text}
            </div>
          ))}
        </div>
      </div>
      <label className="hint-text" htmlFor={`note-${entry.order_id}`} style={{ display: 'block', marginTop: 'var(--space-3)' }}>
        Why (what the AI missed, or why a flag was wrong) — this becomes a rule
      </label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start' }}>
        <textarea id={`note-${entry.order_id}`} className="input" rows={2} value={note} onChange={(e) => { setNote(e.target.value); setSaved(''); }} style={{ flex: 1 }} />
        <button type="button" className="btn btn-secondary" onClick={save}>Save</button>
      </div>
      {saved && <p className="hint-text" style={{ margin: '4px 0 0' }}>{saved}</p>}
    </div>
  );
}

export default function ProductionReviewLog() {
  const { state } = useAppState();
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!state.isProductionManager) return;
    fetchReviewLog()
      .then(setEntries)
      .catch((err) => {
        console.error('Could not load the review log:', err);
        setError('Could not load the review log. Check your connection and refresh.');
      });
  }, [state.isProductionManager]);

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-kicker">Production</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Review Log</div>
        {!state.isProductionManager && <p className="hint-text">Only the production manager can see the review log.</p>}
        {state.isProductionManager && (
          <>
            <p className="hint-text">Every reviewed order: what was changed by hand next to what AI Review flagged. Write why where they differ.</p>
            {error && <p className="hint-text" style={{ color: '#b0392e', fontWeight: 600 }}>{error}</p>}
            {!entries && !error && <p className="hint-text">Loading…</p>}
            {entries && entries.length === 0 && <p className="hint-text">No reviewed orders logged yet — they appear here after their Done Review.</p>}
          </>
        )}
      </div>
      {(entries || []).map((e) => <LogEntry key={e.order_id} entry={e} />)}
    </div>
  );
}
