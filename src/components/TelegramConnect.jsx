import { useEffect, useState } from 'react';
import { createTelegramLinkCode, isTelegramLinked } from '../lib/ordersApi';

// Salesman dashboard: link this account to his Telegram (Sean, 2026-11-05; migration 0114). The code
// goes to ExcelFormAgent once; after that a FORM ANUGERAH he sends with the Function Details list comes
// back as a link that opens the order here, filled in.
export default function TelegramConnect() {
  const [linked, setLinked] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    isTelegramLinked().then(setLinked).catch((err) => { console.error('Telegram link check failed:', err); setLinked(false); });
  }, []);

  const getCode = async () => {
    setBusy(true);
    setError('');
    try {
      setCode(await createTelegramLinkCode());
    } catch (err) {
      console.error('Could not make a Telegram code:', err);
      setError('Could not make a code. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (linked === null) return null;
  return (
    <div style={{ textAlign: 'right' }}>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={getCode}>
        {linked ? 'Telegram connected ✓ — connect again' : 'Connect Telegram'}
      </button>
      {code && (
        <p className="hint-text" style={{ margin: 'var(--space-2) 0 0' }}>
          Send <b style={{ fontSize: '1.2em', letterSpacing: 2 }}>{code}</b> to ExcelFormAgent on Telegram (valid 15 minutes).
        </p>
      )}
      {error && <p className="hint-text" style={{ margin: 'var(--space-2) 0 0', color: '#b3261e' }}>{error}</p>}
    </div>
  );
}
