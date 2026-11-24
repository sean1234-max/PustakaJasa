// MEDAL DESIGNS (Sean, 2026-11-24): every group named "DESIGN <n>" in E CUT 0 is a medal design. "Update from
// E CUT 0" has this computer's AI File helper (v8) read them in Illustrator; a new one comes in hidden until
// Production publishes it — salesmen pick only published ones (phase 2). Rules: utils/medalDesigns.js.
import { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import {
  MEDAL_DESIGN_HELPER_VERSION, getAiFileHelperJob, getAiFileHelperStatus, startMedalDesignExport,
} from '../lib/aiFileHelper';
import { fetchMedalDesigns, medalPictureUrl, saveDesignExport, updateMedalDesigns } from '../lib/medalDesignsApi';
import { moveDesign, sortDesigns } from '../utils/medalDesigns';

const POLL_MS = 3000;
const OK = '#1f8a3b';
const BAD = '#c0392b';

const statusOf = (row) => (!row.in_file ? { text: 'Not in E CUT 0', color: BAD }
  : row.hidden ? { text: 'Hidden', color: '#6b6b6b' } : { text: 'Published', color: OK });

function exportSummary({ added, gone, count }, log) {
  const failed = log.filter((l) => /FAILED/.test(l));
  return [
    `Read ${count} design${count === 1 ? '' : 's'} from E CUT 0.`,
    added.length ? `New, hidden until you publish: ${added.join(', ')}.` : '',
    gone.length ? `No longer in E CUT 0 (salesmen can't pick them): ${gone.join(', ')}.` : '',
    ...failed,
  ].filter(Boolean).join(' ');
}

function DesignCard({ row, isFirst, isLast, busy, onChange, onMove }) {
  const status = statusOf(row);
  return (
    <div className="card elev-md" style={{ padding: 'var(--space-3)', margin: 0 }}>
      <img src={medalPictureUrl(row.preview.thumb)} alt={`${row.name} preview`} style={{ width: '100%', aspectRatio: '1', objectFit: 'contain' }} />
      <p style={{ margin: 'var(--space-2) 0' }}>
        <strong>{row.name}</strong>{' '}
        <span style={{ color: status.color, fontWeight: 600 }}>· {status.text}</span>
      </p>
      <label className="hint-text" htmlFor={`label-${row.name}`}>Name salesmen see</label>
      <input
        id={`label-${row.name}`}
        className="input"
        defaultValue={row.label}
        placeholder={row.name}
        maxLength={60}
        disabled={busy}
        onBlur={(e) => { if (e.target.value.trim() !== row.label) onChange({ label: e.target.value.trim() }); }}
      />
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
        <button
          type="button"
          className={`btn ${row.hidden ? 'btn-primary' : 'btn-secondary'}`}
          disabled={busy || (row.hidden && !row.in_file)}
          onClick={() => onChange({ hidden: !row.hidden })}
        >
          {row.hidden ? 'Publish' : 'Hide'}
        </button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={`Move ${row.name} left`} disabled={busy || isFirst} onClick={() => onMove(-1)}>←</button>
        <button type="button" className="btn btn-ghost btn-icon" aria-label={`Move ${row.name} right`} disabled={busy || isLast} onClick={() => onMove(1)}>→</button>
      </div>
    </div>
  );
}

export default function ProductionMedalDesigns() {
  const [rows, setRows] = useState(null);
  const [message, setMessage] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(sortDesigns(await fetchMedalDesigns()));
    } catch (err) {
      console.error('Failed to load medal designs:', err);
      setMessage({ ok: false, text: 'Could not load the medal designs. Please refresh the page.' });
      setRows([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // the helper's run: polled until done, then saved
  useEffect(() => {
    if (!jobId) return undefined;
    const timer = setInterval(async () => {
      const job = await getAiFileHelperJob(jobId);
      if (job && (job.status === 'queued' || job.status === 'running')) return;
      clearInterval(timer);
      setJobId(null);
      try {
        if (!job) throw new Error('The AI File helper on this computer stopped responding.');
        if (job.status !== 'done') throw new Error(job.message || 'Illustrator could not read E CUT 0.');
        const result = await saveDesignExport(job, await fetchMedalDesigns());
        setMessage({ ok: true, text: exportSummary(result, job.log || []) });
        await load();
      } catch (err) {
        console.error('Medal design update failed:', err);
        setMessage({ ok: false, text: err.message });
      } finally {
        setBusy(false);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, load]);

  const handleUpdate = async () => {
    setMessage(null);
    const status = await getAiFileHelperStatus();
    if (!status) { setMessage({ ok: false, text: "The AI File helper isn't running on this computer, so E CUT 0 can't be read here." }); return; }
    if ((status.version || 0) < MEDAL_DESIGN_HELPER_VERSION) {
      setMessage({ ok: false, text: `This computer's AI File helper is v${status.version || '?'} — run its installer again (v${MEDAL_DESIGN_HELPER_VERSION} needed).` });
      return;
    }
    setBusy(true);
    try {
      setJobId(await startMedalDesignExport());
      setMessage({ ok: true, text: 'Reading E CUT 0 in Illustrator… (about a minute)' });
    } catch (err) {
      setBusy(false);
      setMessage({ ok: false, text: err.message });
    }
  };

  const save = async (changes) => {
    if (!changes.length) return;
    setBusy(true);
    try {
      await updateMedalDesigns(changes);
      await load();
    } catch (err) {
      console.error('Failed to save medal design:', err);
      setMessage({ ok: false, text: 'Could not save that change. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-wrap">
      <Nav />
      <div className="card elev-md">
        <div className="card-kicker">Production</div>
        <div className="card-title" style={{ marginBottom: 'var(--space-2)' }}>Medal Designs</div>
        <p className="hint-text">
          Every group named DESIGN 1, DESIGN 2 … in E CUT 0 is a medal design. To add one: in Illustrator copy a DESIGN
          group, rename it to the next number (DESIGN 3), change it, and save E CUT 0 on the Mac and the NAS. Then press
          Update from E CUT 0 here. A new design starts hidden — check its picture, give it a name and Publish it.
          Never rename a DESIGN group that orders already use.
        </p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={handleUpdate}>
          {jobId ? 'Reading E CUT 0…' : 'Update from E CUT 0'}
        </button>
        {message && <p className="hint-text" style={{ color: message.ok ? OK : BAD, fontWeight: 600 }}>{message.text}</p>}
        {rows === null && <p className="hint-text">Loading…</p>}
        {rows?.length === 0 && <p className="hint-text">No designs yet — press Update from E CUT 0.</p>}
        {rows?.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
            {rows.map((row, i) => (
              <DesignCard
                key={row.name}
                row={row}
                isFirst={i === 0}
                isLast={i === rows.length - 1}
                busy={busy}
                onChange={(patch) => save([{ name: row.name, ...patch }])}
                onMove={(step) => save(moveDesign(rows, row.name, step))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
