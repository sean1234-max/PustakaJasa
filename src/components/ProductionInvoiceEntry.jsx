import { useState } from 'react';
import ConfirmButton from './ConfirmButton';
import { useAppState } from '../state/useAppState';

// Production enters the Invoice Number when Store Admin forgot it and the
// hard copy already reached Production (Sean, 2026-10-13) — every Production
// account, not only the manager (kesin, sean … — Sean, 2026-10-20). Same
// save as Store Admin's (setInvoiceId: duplicate check, status → In
// Production, urgent Sheet); the database records who and when (0086).
// Shown only for a Salesman Approved order with no number yet.
export default function ProductionInvoiceEntry({ order }) {
  const { state, setInvoiceId } = useAppState();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  if (state.role !== 'production' || order.status !== 'Salesman Approved' || order.invoiceId) return null;

  const save = async () => {
    setSaving(true);
    const res = await setInvoiceId(order.id, draft);
    setSaving(false);
    if (res.ok) setDraft('');
  };

  return (
    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
      <input
        className="input" style={{ flex: 1, minWidth: 140 }} value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="Invoice Number (Store Admin forgot)" aria-label={`Invoice Number for ${order.id}`}
      />
      <ConfirmButton
        label={saving ? 'Saving…' : 'Save Invoice'}
        question={`Save Invoice Number ${draft.replace(/\s+/g, '')} for ${order.id}? It moves to Typing (In Production for everyone else).`}
        confirmLabel="Yes, save"
        disabled={saving || !draft.trim()}
        onConfirm={save}
      />
    </div>
  );
}
