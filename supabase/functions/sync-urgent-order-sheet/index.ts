// Writes an urgent order's row to an external Google Sheet (one row per
// order, see below) — first when Store Admin saves the Invoice Number
// (src/state/AppState.jsx's attemptUrgentSheetSync), then again whenever its
// total changes afterwards (add-on approved, amend), so the Sheet's
// amount and 2.5% commission stay current. Management totals it per
// salesman at month-end.
//
// Only the order ID is taken from the request; every value is read from
// the order as the caller (RLS). The Google call is a raw `fetch` with the
// service-account JWT signed by Deno's Web Crypto — no googleapis dependency.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Same rate as src/utils/urgentOrder.js's URGENT_COMMISSION_RATE (an Edge
// Function can't import from src/) — change both together.
const URGENT_COMMISSION_RATE = 0.025;

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

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (!GOOGLE_CLIENT_EMAIL || !GOOGLE_PRIVATE_KEY_RAW || !SPREADSHEET_ID || !SHEET_RANGE) {
    return jsonResponse({ error: 'Google Sheets sync is not configured yet. Contact an admin.' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }
  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!orderId) return jsonResponse({ error: 'Order ID is required.' }, 400);

  // Everything written comes from the order itself, read as the CALLER (RLS):
  // whoever can see the order may refresh its row, and nobody can put
  // figures in the Sheet that the order doesn't hold.
  const { data: order, error: orderError } = await callerClient
    .from('orders')
    .select('id, invoice_id, total_amount, sales, sekolah, shipment_date, function_date, date_placed, urgent')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError || !order) return jsonResponse({ error: 'Order not found.' }, 404);
  if (!order.urgent) return jsonResponse({ error: 'This order is not urgent.' }, 400);
  const amount = Number(order.total_amount) || 0;
  const commission = Math.round(amount * URGENT_COMMISSION_RATE * 100) / 100;
  const row = [
    order.id, order.invoice_id || '', amount, order.sales || '', order.sekolah || '',
    malaysiaDay(order.shipment_date || ''), malaysiaDay(order.function_date || ''), order.date_placed || '',
    malaysiaDateTime(new Date()), commission,
  ];

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (err) {
    console.error('Google OAuth failed:', err);
    return jsonResponse({ error: 'Could not authenticate with Google Sheets. Please try again.' }, 502);
  }
  const sheetsBase = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // One row per order: its row is updated in place once it exists (an
  // add-on or amend changes the total and commission),
  // otherwise appended. The last row carrying this Order ID wins.
  const tab = SHEET_RANGE.split('!')[0];
  const idsResp = await fetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A:A`)}`, { headers });
  if (!idsResp.ok) {
    console.error('Google Sheets read failed:', idsResp.status, await idsResp.text());
    return jsonResponse({ error: 'Could not read the tracking sheet. Please try again.' }, 502);
  }
  const ids: string[][] = (await idsResp.json()).values || [];
  let rowNumber = 0;
  ids.forEach((r, i) => { if (r[0] === order.id) rowNumber = i + 1; });

  const writeResp = rowNumber
    ? await fetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A${rowNumber}:J${rowNumber}`)}?valueInputOption=USER_ENTERED`, {
      method: 'PUT', headers, body: JSON.stringify({ values: [row] }),
    })
    : await fetch(`${sheetsBase}/${encodeURIComponent(`${tab}!A:J`)}:append?valueInputOption=USER_ENTERED`, {
      method: 'POST', headers, body: JSON.stringify({ values: [row] }),
    });
  if (!writeResp.ok) {
    console.error('Google Sheets write failed:', writeResp.status, await writeResp.text());
    return jsonResponse({ error: 'Could not write to the tracking sheet. Please try again.' }, 502);
  }

  return jsonResponse({ ok: true });
});
