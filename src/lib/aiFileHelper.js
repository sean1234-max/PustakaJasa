// Talks to the "AI File helper" running on THIS computer
// (scripts/ai-file-helper/). A web page can't check local folders or start
// Illustrator, so "Generate AI File" asks the helper on the clicking
// computer instead — and only that computer runs the job.
import { supabase } from './supabaseClient';

const HELPER_URL = 'http://127.0.0.1:47821';

// The name SEAN.jsx stamps on the AI file, per Production account (Sean, 2026-10-22) — sent with
// Generate AI File so Illustrator doesn't ask; any other account is still asked.
const OPERATOR_BY_EMAIL = { 'production@pjsb.com': 'SITI', 'sean@pjsb.com': 'SEAN', 'kesin@pjsb.com': 'KESIN', 'lun@pjsb.com': 'LUN' };
export async function operatorName() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    return OPERATOR_BY_EMAIL[(user?.email || '').toLowerCase()] || '';
  } catch {
    return '';
  }
}

// null = no helper answering on this computer (not installed / not running).
// No timeout on purpose: the first call may sit behind Chrome's "allow this
// site to access other apps on this device" prompt until the user answers.
export async function getAiFileHelperStatus() {
  try {
    const res = await fetch(`${HELPER_URL}/status`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Which template .ai each Jenis Plak would open (helper v4; null = none) — null when this
// computer's helper is older or not running.
export async function getAiFileTemplates(codes) {
  try {
    const res = await fetch(`${HELPER_URL}/templates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes }),
    });
    return res.ok ? (await res.json()).templates || null : null;
  } catch {
    return null;
  }
}

// school: the order's — the helper (v3) also copies the files into that school's NAS folder
export async function startAiFileHelperJob(filename, csv, school = '') {
  const operator = await operatorName();
  const res = await fetch(`${HELPER_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, csv, school, operator }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `AI File helper returned ${res.status}`);
  return body.jobId;
}

// null = the helper stopped answering (quit/restarted mid-job).
export async function getAiFileHelperJob(jobId) {
  try {
    const res = await fetch(`${HELPER_URL}/jobs/${encodeURIComponent(jobId)}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// Done Typing (helper v7, Sean 2026-11-16): the order's folder / .ai files in the school's NAS folder moved into its
// year folder ("2026") by the helper on THIS computer. -> a line for the page; never throws.
const ARCHIVE_HELPER_VERSION = 7;
export async function archiveOrderFiles(school, invoices, year) {
  const status = await getAiFileHelperStatus();
  if (!status) return `📁 AI File helper not running on this computer — move the AI file into ${year} by hand.`;
  if ((status.version || 0) < ARCHIVE_HELPER_VERSION) return `📁 This computer's AI File helper is too old (v${status.version || '?'}, needs v${ARCHIVE_HELPER_VERSION}) — move the AI file into ${year} by hand.`;
  try {
    const res = await fetch(`${HELPER_URL}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ school, invoices, year: String(year) }),
    });
    const body = await res.json().catch(() => ({}));
    return `📁 ${body.message || body.error || `AI File helper returned ${res.status}`}`;
  } catch {
    return `📁 AI File helper didn't answer — move the AI file into ${year} by hand.`;
  }
}
