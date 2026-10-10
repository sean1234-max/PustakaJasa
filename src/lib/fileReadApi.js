import { supabase } from './supabaseClient';

// AI sheet reader — see supabase/functions/read-order-file and
// /mnt/project-files/ai-agent-design. Off unless VITE_AI_READER_ENABLED=1,
// and only offered to the roles in VITE_AI_READER_ROLES (default
// "salesman"); the function re-checks the role itself (READER_ROLES).
export const AI_READER_ENABLED = import.meta.env?.VITE_AI_READER_ENABLED === '1';
const AI_READER_ROLES = String(import.meta.env?.VITE_AI_READER_ROLES || 'salesman').split(',').map((s) => s.trim());

export function canUseAiReader(role) {
  return AI_READER_ENABLED && AI_READER_ROLES.includes(role);
}

// Never throws. Resolves to { ok:true, mapping, cached } or
// { ok:false, message } (budget used up, rate limit, too large, failure).
export async function readSheetsWithAi({ fileName, irText, sheetNames }) {
  try {
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: { fileName, irText, sheetNames } });
    if (error || !data) return { ok: false, message: 'The AI reader is not available right now — please add these sheets by hand.' };
    if (data.status === 'succeeded' && data.mapping) return { ok: true, mapping: data.mapping, cached: !!data.cached, runId: data.runId };
    return { ok: false, message: data.message || 'The AI could not read these sheets — please add them by hand.' };
  } catch {
    return { ok: false, message: 'The AI reader is not available right now — please add these sheets by hand.' };
  }
}

// Text PDFs (phase 2): irText is the PDF's structure map (pdfIr.js); the
// answer is segment references (pdfMapping.js). Same shape as above.
export async function readPdfWithAi({ fileName, irText }) {
  const fail = 'The AI reader is not available right now — please add this order by hand.';
  try {
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: { kind: 'pdf', fileName, irText } });
    if (error || !data) return { ok: false, message: fail };
    if (data.status === 'succeeded' && data.mapping) return { ok: true, reading: data.mapping, cached: !!data.cached, runId: data.runId };
    return { ok: false, message: data.message || 'The AI could not read this PDF — please add the order by hand.' };
  } catch {
    return { ok: false, message: fail };
  }
}

// Admin banner (AiBudgetBanner.jsx). Resolves to null on any error.
export async function getAiBudgetStatus() {
  try {
    const { data, error } = await supabase.rpc('ai_budget_status');
    if (error || !Array.isArray(data) || !data[0]) return null;
    const r = data[0];
    return { spentMyr: Number(r.spent_myr), capMyr: Number(r.cap_myr), pct: Number(r.pct), alertPct: Number(r.alert_pct), blocked: !!r.blocked };
  } catch {
    return null;
  }
}
