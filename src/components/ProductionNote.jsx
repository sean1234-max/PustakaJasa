import { useState } from 'react';
import { useAppState } from '../state/useAppState';

// Production's own remark on an In Production card (Sean, 2026-11-05): what is done, what is still
// waiting. Saves when the box loses focus; only Production sees it.
export default function ProductionNote({ order }) {
  const { setProductionNote } = useAppState();
  const saved = order.productionNote || '';
  const [draft, setDraft] = useState(saved);
  const [msg, setMsg] = useState(null);

  const save = async () => {
    if (draft.trim() === saved) return;
    setMsg({ text: 'Saving…' });
    const err = await setProductionNote(order.id, draft);
    setMsg(err ? { text: err, error: true } : { text: 'Saved' });
  };

  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <textarea
        className="input" rows={2} style={{ width: '100%', resize: 'vertical' }}
        value={draft} onChange={(e) => { setDraft(e.target.value); setMsg(null); }} onBlur={save}
        placeholder="Production remark…" aria-label={`Production remark for ${order.id}`}
      />
      {msg && <div className="hint-text" style={{ margin: '2px 0 0', color: msg.error ? '#b91c1c' : undefined }}>{msg.text}</div>}
    </div>
  );
}
