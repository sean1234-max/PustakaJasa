import { supabase } from './supabaseClient';

// AI sheet reader — see supabase/functions/read-order-file and
// /mnt/project-files/ai-agent-design. Off unless VITE_AI_READER_ENABLED=1,
// and only offered to the roles in VITE_AI_READER_ROLES (default
// "salesman,teacher": both upload orders on New Order); the function
// re-checks the role itself (READER_ROLES).
export const AI_READER_ENABLED = import.meta.env?.VITE_AI_READER_ENABLED === '1';
const AI_READER_ROLES = String(import.meta.env?.VITE_AI_READER_ROLES || 'salesman,teacher').split(',').map((s) => s.trim());

export function canUseAiReader(role) {
  return AI_READER_ENABLED && AI_READER_ROLES.includes(role);
}

// Never throws. Resolves to { ok:true, mapping, cached } or
// { ok:false, message } (budget used up, rate limit, too large, failure).
// `instructions` (optional): the user's Custom Instructions for AI, sent
// with the file so the reader can follow the ones about how to read it.
const withInstructions = (body, instructions) => (instructions && instructions.trim() ? { ...body, instructions: instructions.trim() } : body);

export async function readSheetsWithAi({ fileName, irText, sheetNames, instructions }) {
  try {
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: withInstructions({ fileName, irText, sheetNames }, instructions) });
    if (error || !data) return { ok: false, message: 'The AI reader is not available right now — please add these sheets by hand.' };
    if (data.status === 'succeeded' && data.mapping) return { ok: true, mapping: data.mapping, cached: !!data.cached, runId: data.runId };
    return { ok: false, message: data.message || 'The AI could not read these sheets — please add them by hand.' };
  } catch {
    return { ok: false, message: 'The AI reader is not available right now — please add these sheets by hand.' };
  }
}

// Text PDFs (phase 2): irText is the PDF's structure map (pdfIr.js); the
// answer is segment references (pdfMapping.js). Same shape as above.
export async function readPdfWithAi({ fileName, irText, instructions }) {
  const fail = 'The AI reader is not available right now — please add this order by hand.';
  try {
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: withInstructions({ kind: 'pdf', fileName, irText }, instructions) });
    if (error || !data) return { ok: false, message: fail };
    if (data.status === 'succeeded' && data.mapping) return { ok: true, reading: data.mapping, cached: !!data.cached, runId: data.runId };
    return { ok: false, message: data.message || 'The AI could not read this PDF — please add the order by hand.' };
  } catch {
    return { ok: false, message: fail };
  }
}

// The fixed header lines (school, ceremony, SESI) of a sample label the PDF
// draws as a picture: imageBase64 is a JPEG of page 1, no "data:" prefix.
// Resolves to { ok:true, lines, confidence } or { ok:false } — the order is
// read without it then, as before.
export async function readPdfHeadingWithAi({ fileName, imageBase64 }) {
  try {
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: { kind: 'pdf-heading', fileName, irText: imageBase64 } });
    if (error || !data || data.status !== 'succeeded' || !data.mapping) return { ok: false };
    return { ok: true, lines: data.mapping.lines || [], confidence: data.mapping.confidence };
  } catch {
    return { ok: false };
  }
}

// Page pictures holding plaque photos (kind "pdf-plaques"): each photo's
// code, design and the award it is for. { ok: false } on any problem —
// the order still reads without it.
export async function readPdfPlaquesWithAi({ fileName, pages, images }) {
  try {
    const irText = JSON.stringify({ pages, images });
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: { kind: 'pdf-plaques', fileName, irText } });
    if (error || !data || data.status !== 'succeeded' || !data.mapping) return { ok: false };
    return { ok: true, pictures: data.mapping.pictures || [] };
  } catch {
    return { ok: false };
  }
}

// Custom Instructions for AI (aiInstructions.js): which instructions are
// for `fileName` and what each asks, given the tabs that file filled.
// Resolves to { ok:true, reading } or { ok:false, message }; never throws.
export async function readInstructionsWithAi({ instructions, fileName, files, tabs }) {
  const fail = 'The AI could not check your custom instructions right now — the file was imported without them. Try "Apply instructions" again later.';
  try {
    const irText = JSON.stringify({ instructions, fileName, files, tabs });
    const { data, error } = await supabase.functions.invoke('read-order-file', { body: { kind: 'instructions', fileName, irText } });
    if (error || !data) return { ok: false, message: fail };
    if (data.status === 'succeeded' && data.mapping) return { ok: true, reading: data.mapping, cached: !!data.cached };
    return { ok: false, message: data.message ? `${data.message} The file was imported without your custom instructions.` : fail };
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
