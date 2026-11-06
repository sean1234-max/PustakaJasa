// Production's Done Typing → the Form_Responses sheet (Sean, 2026-11-06). The order's school +
// trophy/plak QTY (selempang left out) is looked up in column F / H; the one unmarked row that matches
// gets "<NAME> (<MONTH>)" in column I (the "Siti" column), centred, all borders — e.g. SEAN (NOV).
//   - no row matches, or more than one does (double key-in? an add-on?) → nothing is written, the
//     website says so and Production asks the salesman;
//   - one order is marked once (typing_sheet_marks, 0116): its other invoices' Done Typing do nothing;
//   - { action: 'clear' } on a Cancelled order takes its mark off the sheet again.
//
// Only the order ID comes from the request; the order is read as the caller (RLS), the name from the
// caller's own email. The Google call is the same service-account fetch as highlight-urgent-kitdoc
// (copied, not shared — move to _shared/ if a fourth one needs it).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { findMarkedRow, findRows, markerName, monthTag, sheetQty, type SheetRow } from './match.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default'];
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];
const GOOGLE_CLIENT_EMAIL = Deno.env.get('GOOGLE_SHEETS_CLIENT_EMAIL');
const GOOGLE_PRIVATE_KEY_RAW = Deno.env.get('GOOGLE_SHEETS_PRIVATE_KEY');
const SHEET_ID = Deno.env.get('TYPING_SPREADSHEET_ID') ?? '1YDKnCokb13iLjjZN30CPqtDlfxrPbGur2hBR3_5A6wA';
const TAB_ID = Number(Deno.env.get('TYPING_SHEET_TAB_ID') ?? '1543931519'); // Form_Responses
const FIRST_DATA_ROW = 2; // row 1 is the header
const MARK_COL = 8; // column I (0-based)
const MARK_ROLES = ['admin', 'production'];
const CLEAR_ROLES = ['admin', 'store_admin', 'production', 'salesman'];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// --- Google service-account token
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

// --- the sheet
async function readRows(H: Record<string, string>): Promise<SheetRow[]> {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
  const meta = await fetch(`${base}?fields=sheets.properties(sheetId,title)`, { headers: H });
  if (!meta.ok) throw new Error(`read sheet: ${meta.status} ${await meta.text()}`);
  const title = ((await meta.json()).sheets || []).find((s: { properties: { sheetId: number } }) => s.properties.sheetId === TAB_ID)?.properties.title;
  if (!title) throw new Error('Form_Responses tab not found');
  const range = `'${String(title).replace(/'/g, "''")}'!F${FIRST_DATA_ROW}:I`;
  const resp = await fetch(`${base}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`, { headers: H });
  if (!resp.ok) throw new Error(`read rows: ${resp.status}`);
  return ((await resp.json()).values || []).map((v: unknown[], i: number) => ({ row: FIRST_DATA_ROW + i, school: v[0], qty: v[2], mark: v[3] }));
}

const BORDER = { style: 'SOLID', color: { red: 0, green: 0, blue: 0 } };
async function writeCell(H: Record<string, string>, row: number, value: string | null) {
  const cell = value === null
    ? {} // cleared: no value, no borders (the alignment is harmless and stays)
    : { userEnteredValue: { stringValue: value }, userEnteredFormat: { horizontalAlignment: 'CENTER', borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER } } };
  const fields = value === null ? 'userEnteredValue,userEnteredFormat.borders' : 'userEnteredValue,userEnteredFormat.horizontalAlignment,userEnteredFormat.borders';
  const resp = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ requests: [{ updateCells: {
      range: { sheetId: TAB_ID, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: MARK_COL, endColumnIndex: MARK_COL + 1 },
      rows: [{ values: [cell] }], fields,
    } }] }),
  });
  if (!resp.ok) throw new Error(`write I${row}: ${resp.status} ${await resp.text()}`);
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
  if (!profile || profile.status !== 'active') return json({ error: 'Not allowed.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* checked below */ }
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!orderId) return json({ error: 'Missing orderId.' }, 400);
  const clearing = body.action === 'clear';
  if (!(clearing ? CLEAR_ROLES : MARK_ROLES).includes(profile.role)) return json({ error: 'Not allowed.' }, 403);

  const { data: order } = await caller.from('orders').select('id, sekolah, items, status').eq('id', orderId).maybeSingle();
  if (!order) return json({ error: 'Order not found.' }, 404);
  const school = String(order.sekolah || '');
  const qty = sheetQty(order.items || []);
  const { data: existing } = await admin.from('typing_sheet_marks').select('sheet_row, value').eq('order_id', orderId).maybeSingle();

  if (clearing && order.status !== 'Cancelled') return json({ error: 'Only a cancelled order is taken off the sheet.' }, 400);
  if (clearing && !existing) return json({ ok: true, result: 'none' });
  if (!clearing && existing) return json({ ok: true, result: 'already', row: existing.sheet_row, value: existing.value });

  let H: Record<string, string>;
  let rows: SheetRow[];
  try {
    H = { Authorization: `Bearer ${await googleToken()}`, 'Content-Type': 'application/json' };
    rows = await readRows(H);
  } catch (err) {
    console.error('typing sheet read failed:', err);
    return json({ error: 'Could not read the Form_Responses sheet (is it shared with the service account?).' }, 502);
  }

  try {
    if (clearing) {
      const row = findMarkedRow(rows, school, qty, existing!.value, existing!.sheet_row);
      if (row) await writeCell(H, row, null);
      await admin.from('typing_sheet_marks').delete().eq('order_id', orderId);
      return json({ ok: true, result: row ? 'cleared' : 'not_found', row, value: existing!.value, school, qty });
    }
    const found = findRows(rows, school, qty);
    if (found.length !== 1) return json({ ok: true, result: found.length ? 'ambiguous' : 'not_found', rows: found, school, qty });
    const value = `${markerName(user.email || '')} (${monthTag(new Date())})`;
    // the mark is claimed first, so two clicks at once can't both write
    const { error: claimErr } = await admin.from('typing_sheet_marks').insert({ order_id: orderId, sheet_row: found[0], value, marked_by: user.id });
    if (claimErr) return json({ ok: true, result: 'already' });
    try {
      await writeCell(H, found[0], value);
    } catch (err) {
      await admin.from('typing_sheet_marks').delete().eq('order_id', orderId);
      throw err;
    }
    return json({ ok: true, result: 'marked', row: found[0], value, school, qty });
  } catch (err) {
    console.error('typing sheet write failed:', err);
    return json({ error: 'Could not write the Form_Responses sheet.' }, 502);
  }
});
