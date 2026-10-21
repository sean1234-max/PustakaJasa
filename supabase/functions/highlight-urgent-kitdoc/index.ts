// Store Admin's own KIT DOC sheet (URGENT GROUP ORDER tab) — a row turns red when its
// INVOICE NO (column D) belongs to one of the website's urgent orders AND its DW PRODUCTION
// box (column H) is ticked (Sean, 2026-10-20). Every urgent order counts, Completed too;
// Cancelled doesn't.
//
// Done with ONE conditional-format rule that this function owns (its formula carries the
// marker below): no row is added, moved or deleted, no cell value or format is written —
// the rule only paints over while it matches, so an invoice dropped from the list loses the
// red and keeps whatever look it had. Each run rewrites that one rule's invoice list (or adds
// the rule once); other rules are never touched.
//
// Matching: each line of a column D cell (one cell can list several invoices, one per line),
// trimmed, exact (case, punctuation, leading zeros kept). An urgent invoice found on more than
// one row is left out (not highlighted) and reported, never guessed.
//
// Called by the website after every urgent-sheet sync (src/lib/urgentSheetApi.js). Admin can
// also test it on a scratch copy: { mode: 'test-copy' } then { spreadsheetId, invoices }.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default'];
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];
const GOOGLE_CLIENT_EMAIL = Deno.env.get('GOOGLE_SHEETS_CLIENT_EMAIL');
const GOOGLE_PRIVATE_KEY_RAW = Deno.env.get('GOOGLE_SHEETS_PRIVATE_KEY');
const KITDOC_ID = Deno.env.get('KITDOC_SPREADSHEET_ID') ?? '1GeCTmsplGdK4UYv4IHzb1zO6nQQ0r1Td7IEpFACboE4';
const KITDOC_SHEET_ID = Number(Deno.env.get('KITDOC_SHEET_ID') ?? '949797264');

const MARKER = 'PJ-WEBSITE-URGENT';
const FIRST_DATA_ROW = 5; // row 4 is the header (TIME | ORDER DATE | … | INVOICE NO | …)
const RED = { red: 1, green: 0.5, blue: 0.5 };
const ALLOWED_ROLES = ['admin', 'store_admin', 'production', 'salesman'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// --- Google service-account token (same as sync-urgent-order-sheet; ponytail: copied, not
// shared, so that function stays untouched — move both to _shared/ if a third one needs it)
function base64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64s = (s: string) => base64url(new TextEncoder().encode(s));
function pemToPkcs8(pem: string): ArrayBuffer {
  const bin = atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
async function googleToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64s(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64s(JSON.stringify({
    iss: GOOGLE_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(GOOGLE_PRIVATE_KEY_RAW!.replace(/\\n/g, '\n')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${base64url(new Uint8Array(sig))}` }),
  });
  const body = await resp.json();
  if (!resp.ok || !body.access_token) throw new Error(`Google token: ${body.error_description || body.error || resp.status}`);
  return body.access_token;
}

// --- the rule
const escRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function ruleFormula(invoices: string[]): string {
  const d = `$D${FIRST_DATA_ROW}`, h = `$H${FIRST_DATA_ROW}`;
  if (invoices.length === 0) return `=AND(FALSE,N("${MARKER}")=0)`;
  // any one line of the cell, spaces around it ignored
  const pattern = `(^|\\n)[ \\t]*(${invoices.map(escRegex).join('|')})[ \\t]*(\\r?\\n|$)`.replace(/"/g, '""');
  return `=AND(${h}=TRUE,REGEXMATCH(TO_TEXT(${d}),"${pattern}"),N("${MARKER}")=0)`;
}

// Urgent invoices found exactly once in column D are highlighted; the rest are reported.
export function pickInvoices(urgent: string[], columnD: string[]) {
  const count = new Map<string, number>();
  columnD.forEach((v) => {
    new Set(String(v ?? '').split(/\r?\n/).map((t) => t.trim()).filter(Boolean)).forEach((t) => count.set(t, (count.get(t) || 0) + 1));
  });
  const highlight: string[] = [], duplicates: { invoice: string; rows: number }[] = [], notFound: string[] = [];
  [...new Set(urgent.map((s) => s.trim()).filter(Boolean))].sort().forEach((inv) => {
    const n = count.get(inv) || 0;
    if (n === 1) highlight.push(inv);
    else if (n > 1) duplicates.push({ invoice: inv, rows: n });
    else notFound.push(inv);
  });
  return { highlight, duplicates, notFound };
}

async function applyRule(token: string, spreadsheetId: string, sheetId: number, invoices: string[]) {
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const metaResp = await fetch(`${base}?fields=sheets(properties(sheetId,title),conditionalFormats)`, { headers: H });
  if (!metaResp.ok) throw new Error(`read sheet: ${metaResp.status} ${await metaResp.text()}`);
  const sheet = ((await metaResp.json()).sheets || []).find((s: { properties: { sheetId: number } }) => s.properties.sheetId === sheetId);
  if (!sheet) throw new Error('tab not found');
  const title = sheet.properties.title as string;

  const colResp = await fetch(`${base}/values/${encodeURIComponent(`'${title.replace(/'/g, "''")}'!D${FIRST_DATA_ROW}:D`)}`, { headers: H });
  if (!colResp.ok) throw new Error(`read column D: ${colResp.status}`);
  const columnD = ((await colResp.json()).values || []).map((r: string[]) => r[0] ?? '');
  const picked = pickInvoices(invoices, columnD);
  const formula = ruleFormula(picked.highlight);

  const rules = (sheet.conditionalFormats || []) as { booleanRule?: { condition?: { values?: { userEnteredValue?: string }[] } } }[];
  const ours = rules.map((r, i) => ({ i, f: r.booleanRule?.condition?.values?.[0]?.userEnteredValue || '' })).filter((r) => r.f.includes(MARKER));
  const rule = {
    ranges: [{ sheetId, startRowIndex: FIRST_DATA_ROW - 1, startColumnIndex: 0, endColumnIndex: 10 }],
    booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] }, format: { backgroundColor: RED } },
  };
  const requests: unknown[] = [];
  if (ours.length === 0) requests.push({ addConditionalFormatRule: { index: 0, rule } });
  else if (ours[0].f !== formula) requests.push({ updateConditionalFormatRule: { index: ours[0].i, sheetId, rule } });
  // never more than one rule of ours (bottom-up, so earlier indexes stay valid)
  ours.slice(1).reverse().forEach((r) => requests.push({ deleteConditionalFormatRule: { index: r.i, sheetId } }));
  if (requests.length) {
    const upd = await fetch(`${base}:batchUpdate`, { method: 'POST', headers: H, body: JSON.stringify({ requests }) });
    if (!upd.ok) throw new Error(`update rule: ${upd.status} ${await upd.text()}`);
  }
  if (picked.duplicates.length) console.warn('KIT DOC: urgent invoice(s) on more than one row, not highlighted:', JSON.stringify(picked.duplicates));
  return { ...picked, changed: requests.length > 0, tab: title };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_RAW) return json({ error: 'Google Sheets is not configured.' }, 500);
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
  const caller = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not authenticated.' }, 401);
  const admin = createClient(SUPABASE_URL, SECRET_KEY);
  const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).single();
  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) return json({ error: 'Not allowed.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body: a normal run */ }
  const testing = body.mode === 'test-copy' || typeof body.spreadsheetId === 'string';
  if (testing && profile.role !== 'admin') return json({ error: 'Only admin can test.' }, 403);

  let token: string;
  try { token = await googleToken(); } catch (err) { console.error(err); return json({ error: 'Could not sign in to Google.' }, 502); }

  // Admin test: a scratch spreadsheet with KIT DOC's values (A:J), owned by the service account
  if (body.mode === 'test-copy') {
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const meta = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${KITDOC_ID}?fields=sheets.properties(sheetId,title)`, { headers: H })).json();
    const title = (meta.sheets || []).find((s: { properties: { sheetId: number } }) => s.properties.sheetId === KITDOC_SHEET_ID)?.properties.title;
    if (!title) return json({ error: 'KIT DOC tab not found (is it shared with the service account?)' }, 502);
    const vals = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${KITDOC_ID}/values/${encodeURIComponent(`'${title}'!A1:J`)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: H })).json();
    const created = await (await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST', headers: H, body: JSON.stringify({ properties: { title: `TEST KIT DOC ${new Date().toISOString()}` }, sheets: [{ properties: { title: 'TEST', gridProperties: { rowCount: 2000, columnCount: 12 } } }] }),
    })).json();
    if (!created.spreadsheetId) return json({ error: 'The service account cannot create a spreadsheet — make a copy of KIT DOC by hand and share it with it.' }, 502);
    const sid = created.sheets[0].properties.sheetId;
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent('TEST!A1')}?valueInputOption=RAW`, { method: 'PUT', headers: H, body: JSON.stringify({ values: vals.values || [] }) });
    return json({ spreadsheetId: created.spreadsheetId, sheetId: sid, rows: (vals.values || []).length });
  }

  let invoices: string[];
  if (Array.isArray(body.invoices)) invoices = (body.invoices as unknown[]).map(String);
  else {
    const { data, error } = await admin.from('orders').select('invoice_id, invoice_groups').eq('urgent', true).neq('status', 'Cancelled');
    if (error) return json({ error: 'Could not read the urgent orders.' }, 500);
    invoices = (data || []).flatMap((o) => [o.invoice_id, ...((o.invoice_groups || []) as { invoiceId?: string }[]).map((g) => g.invoiceId)]).filter(Boolean) as string[];
  }
  try {
    const result = await applyRule(token, testing ? String(body.spreadsheetId) : KITDOC_ID, testing ? Number(body.sheetId) : KITDOC_SHEET_ID, invoices);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('KIT DOC highlight failed:', err);
    return json({ error: 'Could not update KIT DOC.' }, 502);
  }
});
