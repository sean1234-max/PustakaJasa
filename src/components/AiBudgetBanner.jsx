import { useEffect, useState } from 'react';
import { getAiBudgetStatus } from '../lib/fileReadApi';

// Admin-only red banner under the nav once this month's AI spend reaches
// the alert level (default 80% of RM150) — owner, 2026-10-07: in-app, no
// email. At 100% every AI feature pauses until the 1st (ai_budget_status,
// migration 0085). Shows nothing until the RPC exists / on any error.
export default function AiBudgetBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    getAiBudgetStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, []);
  if (!status || status.pct < status.alertPct) return null;
  const text = status.blocked
    ? `AI budget used up: RM${status.spentMyr.toFixed(2)} of RM${status.capMyr.toFixed(0)} this month. AI reading and spell-check are paused until the 1st.`
    : `AI budget at ${status.pct}%: RM${status.spentMyr.toFixed(2)} of RM${status.capMyr.toFixed(0)} this month. AI pauses at RM${status.capMyr.toFixed(0)}.`;
  return (
    <div role="alert" className="login-error" style={{ margin: 0, borderRadius: 0, textAlign: 'center', fontWeight: 600 }}>
      {text}
    </div>
  );
}
