// Keeps an urgent order's row in an external Google Sheet (one row per
// order, see below) — written when Store Admin saves the Invoice Number
// (src/state/AppState.jsx's attemptUrgentSheetSync), refreshed whenever its
// total or Shipment Date changes, and removed when Production marks the
// order Normal (updateShipmentAndUrgency). Management totals it per
// salesman at month-end.
//
// Only the order ID is taken from the request; every value is read from
// the order as the caller (RLS). The Google call is a raw `fetch` (googleFetch: timeout + tries) with the
// service-account JWT signed by Deno's Web Crypto — no googleapis dependency.
// pg_cron also calls it ({ action: 'retry' }, 0128): rows that never got written, or a cancelled order's.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { googleFetch } from '../_shared/googleFetch.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default'];
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];

// Google service-account credentials for the Sheets API — set via
// `supabase secrets set`. The private key is a PEM; Deno env vars can't
// hold literal newlines, so it's stored with `\n` escapes and unescaped
// below. SHEET_RANGE is the target tab, e.g. `'Urgent Orders'!A:I`.
const GOOGLE_CLIENT_EMAIL = Deno.env.get('GOOGLE_SHEETS_CLIENT_EMAIL');
const GOOGLE_PRIVATE_KEY_RAW = Deno.env.get('GOOGLE_SHEETS_PRIVATE_KEY');
const SPREADSHEET_ID = Deno.env.get('GOOGLE_SHEETS_SPREADSHEET_ID');
const SHEET_RANGE = Deno.env.get('GOOGLE_SHEETS_SHEET_RANGE');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// The urgent list just changed, so KIT DOC's red rows are refreshed here on the
// server (highlight-urgent-kitdoc, as the same caller) — not by the website,
// whose tab may be running code from before the feature (Sean, 2026-10-21:
// an 8:56 sync from a stale tab never turned Kent's row red). A failure only
// leaves the red one change behind; the sync itself still succeeds.
async function refreshKitDocHighlight(authHeader: string) {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/highlight-urgent-kitdoc`, {
      method: 'POST',
      headers: { Authorization: authHeader, apikey: PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!resp.ok) console.error('KIT DOC highlight failed:', resp.status, await resp.text());
  } catch (err) {
    console.error('KIT DOC highlight failed:', err);
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same rate as src/utils/urgentOrder.js's URGENT_COMMISSION_RATE (an Edge
// Function can't import from src/) — change both together.
const URGENT_COMMISSION_RATE = 0.025;

// An order Production keyed in for a salesman (0125, Sean 2026-11-11) — the salesman is charged 1.5% of the
// order total. Its own tab in the same spreadsheet (made here the first time, with its header), one row per
// order from its invoice on; removed when it's cancelled. Called with { orderId, sheet: 'keyin' }.
// An urgent one is only in the urgent tab (2.5%), never here too (Sean, 2026-11-23: one sheet per order —
// invoiced on the 1st and shipping by the 7th is urgent; from the 8th it's 1.5%).
const KEYIN_RATE = 0.015;
const KEYIN_TAB = '1.5%';
const KEYIN_HEADER = ['Order ID', 'Invoice', 'Amount', 'Salesman', 'School', 'Keyed in by', 'Date Placed', 'Synced At', '1.5%'];

async function ensureKeyinTab(headers: Record<string, string>): Promise<boolean> {
  const metaResp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties(title)`, { headers });
  if (!metaResp.ok) return false;
  const titles = ((await metaResp.json()).sheets || []).map((sh: { properties: { title: string } }) => sh.properties.title);
  if (titles.includes(KEYIN_TAB)) return true;
  const addResp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
    method: 'POST', headers, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: KEYIN_TAB } } }] }),
  }, false);
  if (!addResp.ok) { console.error('Adding the 1.5% tab failed:', addResp.status, await addResp.text()); return false; }
  const headResp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${KEYIN_TAB}'!A1:I1`)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT', headers, body: JSON.stringify({ values: [KEYIN_HEADER] }),
  });
  if (!headResp.ok) console.error('Writing the 1.5% header failed:', headResp.status, await headResp.text());
  return true;
}

// Dates arrive as stored ISO instants (a Malaysian midnight, e.g.
// "2026-09-21T16:00:00.000Z" = 22 Sep); the Sheet gets "22 Sep 2026".
// Anything that isn't a date (e.g. "TBD") is written as-is.
function malaysiaDay(value: string): string {
  const d = new Date(value);
  if (!value || Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric' });
}
function malaysiaDateTime(d: Date): string {
  return d.toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlFromString(s: string): string {
  return base64url(new TextEncoder().encode(s));
}

function pemToPkcs8(pem: string): ArrayBuffer {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Signs a service-account JWT (RS256) and exchanges it for an OAuth
// access token — the standard Google server-to-server auth flow, done
// entirely with fetch + Web Crypto rather than a client library.
async function getGoogleAccessToken(): Promise<string> {
  const privateKeyPem = GOOGLE_PRIVATE_KEY_RAW!.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: GOOGLE_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64urlFromString(JSON.stringify(header))}.${base64urlFromString(JSON.stringify(claims))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenResp = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenBody = await tokenResp.json();
  if (!tokenResp.ok || !tokenBody.access_token) {
    throw new Error(`Google OAuth token exchange failed: ${tokenBody.error_description || tokenBody.error || tokenResp.status}`);
  }
  return tokenBody.access_token as string;
}

// pg_cron (0128) every 10 minutes: an urgent order whose row was never written (Google down, the tab closed
// before the sync) is written now, and a cancelled one still marked as written has its row removed (Sean,
// 2026-11-23 check: ORD-0417 / ORD-0464 missing, cancelled ORD-0240 / ORD-0381 still listed). Its
// urgent_sheet_synced_at is set / cleared through set_urgent_sheet_synced — the only order write the guard
// lets the secret key make. Orders of the last RETRY_WITHIN_DAYS, RETRY_PER_RUN of each kind per run.
const RETRY_WITHIN_DAYS = 30;
const RETRY_PER_RUN = 10;
const RETRY_RUN_MS = 100_000;          // no new order after this (the function has ~150 s)
const RETRY_QUIET_MS = 3 * 60_000;     // invoiced this recently: the website's own sync may still be running

type SyncResult = { status: number; body: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
type Db = any;

// One order's row in the urgent tab — or, with `keyin`, the 1.5% tab: written / refreshed while the order
// belongs there, removed when it doesn't. Every value comes from the saved order, read through `db`: the
// caller's client from the website (RLS — whoever can see the order may refresh its row, and nobody can put
// figures in the Sheet the order doesn't hold), the secret-key client from the cron retry.
// `authHeader` (the website's caller) also refreshes KIT DOC's red rows; the cron leaves that to the next one.
async function syncOrderRow(db: Db, orderId: string, keyin: boolean, authHeader: string | null): Promise<SyncResult> {
  const { data: order, error: orderError } = await db
    .from('orders')
    .select('id, invoice_id, total_amount, sales, sekolah, shipment_date, function_date, date_placed, urgent, parent_order_id, status, created_by_production, placed_by:snapshot->>placedBy')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError || !order) return { status: 404, body: { error: 'Order not found.' } };
  const amount = Number(order.total_amount) || 0;
  const commission = Math.round(amount * URGENT_COMMISSION_RATE * 100) / 100;
  const row = keyin
    ? [order.id, order.invoice_id || '', amount, order.sales || '', order.sekolah || '', order.placed_by || '', order.date_placed || '',
      malaysiaDateTime(new Date()), Math.round(amount * KEYIN_RATE * 100) / 100]
    : [
      // a Tambahan's own order (0091) has no invoice on the website — billed in AutoCount
      order.id, order.invoice_id || (order.parent_order_id ? `TAMBAHAN ${order.parent_order_id}` : ''), amount, order.sales || '', order.sekolah || '',
      malaysiaDay(order.shipment_date || ''), malaysiaDay(order.function_date || ''), order.date_placed || '',
      malaysiaDateTime(new Date()), commission,
    ];
  const lastCol = keyin ? 'I' : 'J';
  // its row stays while this holds, else it's removed (a cancelled order leaves both tabs)
  const live = order.status !== 'Cancelled';
  const keep = keyin ? !!order.created_by_production && !!order.invoice_id && live && !order.urgent : !!order.urgent && live;

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (err) {
    console.error('Google OAuth failed:', err);
    return { status: 502, body: { error: 'Could not authenticate with Google Sheets. Please try again.' } };
  }
  const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // One row per order: its row is updated in place once it exists (an
  // add-on or amend changes the total and commission),
  // otherwise appended. The last row carrying this Order ID wins.
  if (keyin && !(await ensureKeyinTab(headers))) {
    return { status: 502, body: { error: 'Could not open the 1.5% tab of the tracking sheet. Please try again.' } };
  }
  const tab = keyin ? `'${KEYIN_TAB}'` : SHEET_RANGE!.split('!')[0];
  const refreshRed = () => (keyin || !authHeader ? Promise.resolve() : refreshKitDocHighlight(authHeader));
  const idsResp = await googleFetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A:A`)}`, { headers });
  if (!idsResp.ok) {
    console.error('Google Sheets read failed:', idsResp.status, await idsResp.text());
    return { status: 502, body: { error: 'Could not read the tracking sheet. Please try again.' } };
  }
  const ids: string[][] = (await idsResp.json()).values || [];
  let rowNumber = 0;
  ids.forEach((r, i) => { if (r[0] === order.id) rowNumber = i + 1; });

  // Not (or no longer) belonging here: delete only the row(s) whose Order ID is exactly this
  // order's — bottom-up so earlier indexes stay valid. Nothing else moves.
  if (!keep) {
    const matches = ids.map((r, i) => (r[0] === order.id ? i : -1)).filter((i) => i >= 0).reverse();
    if (matches.length === 0) {
      await refreshRed();
      return { status: 200, body: { ok: true, removed: 0 } };
    }
    const tabTitle = tab.replace(/^'|'$/g, '').replace(/''/g, "'");
    const metaResp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?fields=sheets.properties(sheetId,title)`, { headers });
    if (!metaResp.ok) {
      console.error('Google Sheets metadata read failed:', metaResp.status, await metaResp.text());
      return { status: 502, body: { error: 'Could not read the tracking sheet. Please try again.' } };
    }
    const sheetId = ((await metaResp.json()).sheets || []).find((sh: { properties: { title: string } }) => sh.properties.title === tabTitle)?.properties.sheetId;
    if (sheetId == null) return { status: 502, body: { error: 'The tracking sheet tab was not found.' } };
    // not repeated after a timeout: deleting by row number twice would take the wrong row
    const delResp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        requests: matches.map((i) => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i, endIndex: i + 1 } } })),
      }),
    }, false);
    if (!delResp.ok) {
      console.error('Google Sheets row delete failed:', delResp.status, await delResp.text());
      return { status: 502, body: { error: 'Could not remove the order from the tracking sheet. Please try again.' } };
    }
    await refreshRed();
    return { status: 200, body: { ok: true, removed: matches.length } };
  }

  // an append is not repeated after a timeout (it may be in: a second row); an in-place write is
  const writeResp = rowNumber
    ? await googleFetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A${rowNumber}:${lastCol}${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', headers, body: JSON.stringify({ values: [row] }),
    })
    : await googleFetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A:${lastCol}`)}:append?valueInputOption=USER_ENTERED`, {
      method: 'POST', headers, body: JSON.stringify({ values: [row] }),
    }, false);
  if (!writeResp.ok) {
    console.error('Google Sheets write failed:', writeResp.status, await writeResp.text());
    return { status: 502, body: { error: 'Could not write to the tracking sheet. Please try again.' } };
  }

  await refreshRed();
  return { status: 200, body: { ok: true } };
}

// The Order IDs in the 1.5% tab ([] when it can't be read — nothing is cleaned that run)
async function keyinTabIds(): Promise<string[]> {
  const token = await getGoogleAccessToken();
  const resp = await googleFetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(`'${KEYIN_TAB}'!A:A`)}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) { console.error('1.5% tab read failed:', resp.status, await resp.text()); return []; }
  return ((await resp.json()).values || []).map((r: string[]) => r[0]).filter(Boolean);
}

async function retryAll(admin: Db) {
  const stopAt = Date.now() + RETRY_RUN_MS;
  const since = new Date(Date.now() - RETRY_WITHIN_DAYS * 86_400_000).toISOString();
  const quietBefore = Date.now() - RETRY_QUIET_MS;
  const done: Record<string, string>[] = [];
  const mark = async (id: string, synced: boolean) => {
    const { error } = await admin.rpc('set_urgent_sheet_synced', { p_order_id: id, p_synced: synced });
    if (error) console.error('set_urgent_sheet_synced failed:', id, error.message);
  };
  const run = async (id: string, kind: string, after: boolean) => {
    try {
      const r = await syncOrderRow(admin, id, false, null);
      if (r.status === 200) await mark(id, after);
      done.push({ order: id, kind, status: r.status === 200 ? 'ok' : String(r.body.error || r.status) });
    } catch (err) {
      done.push({ order: id, kind, status: String((err as Error)?.message || err) });
    }
  };

  // urgent, invoiced (or a Tambahan in production — billed in AutoCount), its row never written
  const { data: missing } = await admin.from('orders')
    .select('id, invoice_id, parent_order_id, invoice_set_at, created_at')
    .eq('urgent', true).is('urgent_sheet_synced_at', null).in('status', ['In Production', 'Completed'])
    .gte('created_at', since).order('created_at').limit(50);
  const due = (missing || []).filter((o: Record<string, string | null>) => (o.invoice_id || o.parent_order_id)
    && new Date(o.invoice_set_at || o.created_at || 0).getTime() < quietBefore).slice(0, RETRY_PER_RUN);
  for (const o of due) {
    if (Date.now() > stopAt) break;
    await run(o.id, 'write', true);
  }
  // cancelled, still marked as in the Sheet
  const { data: cancelled } = await admin.from('orders').select('id')
    .eq('status', 'Cancelled').not('urgent_sheet_synced_at', 'is', null).gte('created_at', since).limit(RETRY_PER_RUN);
  for (const o of cancelled || []) {
    if (Date.now() > stopAt) break;
    await run(o.id, 'remove', false);
  }
  // 1.5% tab, one sheet per order: a keyed-in order that is urgent or cancelled has no row there (Sean,
  // 2026-11-23: 18 urgent ones were in both tabs). One read of the tab's Order IDs; only those rows go.
  try {
    const { data: keyins } = await admin.from('orders').select('id, urgent, status')
      .not('created_by_production', 'is', null).gte('created_at', since);
    const wrong = new Set((keyins || []).filter((o: { urgent: boolean; status: string }) => o.urgent || o.status === 'Cancelled')
      .map((o: { id: string }) => o.id));
    const listed = wrong.size && Date.now() < stopAt ? await keyinTabIds() : [];
    for (const id of listed.filter((x) => wrong.has(x)).slice(0, RETRY_PER_RUN)) {
      if (Date.now() > stopAt) break;
      const r = await syncOrderRow(admin, id, true, null); // not kept in that tab → its row is removed
      done.push({ order: id, kind: '1.5% remove', status: r.status === 200 ? 'ok' : String(r.body.error || r.status) });
    }
  } catch (err) {
    console.error('1.5% clean-up failed:', err);
  }
  if (done.length) console.log('urgent retry:', JSON.stringify(done));
  return { status: 'retried', done };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_RAW || !SPREADSHEET_ID || !SHEET_RANGE) {
    return jsonResponse({ error: 'Google Sheets sync is not configured yet. Contact an admin.' }, 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  // the cron's run: works only from the saved orders, so it needs no caller
  if (body.action === 'retry') return jsonResponse(await retryAll(createClient(SUPABASE_URL, SECRET_KEY)));

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

  const callerClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  const keyin = body.sheet === 'keyin';
  if (!orderId) return jsonResponse({ error: 'Order ID is required.' }, 400);

  const r = await syncOrderRow(callerClient, orderId, keyin, authHeader);
  return jsonResponse(r.body, r.status);
});
