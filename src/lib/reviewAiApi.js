import { supabase } from './supabaseClient';

// The AI half of Production's review (supabase/functions/review-order-ai). ADVISORY: never throws —
// any failure (function down, not deployed yet, rate limited, cost capped, bad answer) resolves to
// { issues: [], checked: false }, and the AI Review box shows the rule-only checks alone.
//
// `plaques` is reviewChecks.js's aiPlaquesOf: only id / sheet / header / red / black are sent. The
// answer is kept in this browser per order + wording, so opening the same order again costs nothing;
// changed wording asks again.
// v2 (2026-11-05): J7 dropped and C1 narrowed — answers kept under the old rules are not reused
const CACHE_PREFIX = 'reviewAi:v2:';

const hashOf = (text) => {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const readCache = (key) => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
};
const writeCache = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private window / full — just not cached */ }
};

// A page re-renders several times while it loads — one request per order + wording, shared by all
// of them (it once went out three times at once, three times the cost)
const inFlight = new Map();

export function reviewOrderAi(orderId, plaques) {
  const sent = (plaques || []).map(({ id, sheet, header, red, black }) => ({ id, sheet, header, red, black }));
  if (!orderId || sent.length === 0) return Promise.resolve({ issues: [], checked: false });
  const key = `${CACHE_PREFIX}${orderId}:${hashOf(JSON.stringify(sent))}`;
  const cached = readCache(key);
  if (cached) return Promise.resolve(cached);
  if (!inFlight.has(key)) inFlight.set(key, ask(key, sent).finally(() => inFlight.delete(key)));
  return inFlight.get(key);
}

async function ask(key, sent) {
  try {
    const { data, error } = await supabase.functions.invoke('review-order-ai', { body: { plaques: sent } });
    if (error || !data || !Array.isArray(data.issues)) return { issues: [], checked: false };
    const result = { issues: data.issues, checked: !!data.checked };
    if (result.checked) writeCache(key, result);
    return result;
  } catch {
    return { issues: [], checked: false };
  }
}
