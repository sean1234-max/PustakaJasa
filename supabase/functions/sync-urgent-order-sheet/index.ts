// One-time write of an urgent order's data to an external Google Sheet —
// fired from src/state/AppState.jsx (attemptUrgentSheetSync) right after
// Store Admin saves the Invoice Number for an order flagged `urgent`
// (see src/utils/urgentOrder.js). Never called again for the same order
// afterward (urgent_sheet_synced_at is the idempotency guard on the
// caller's side); management uses the Sheet to total urgent orders per
// salesman at month-end.
//
// Same house style as admin-user-ops/index.ts: two Supabase clients (one
// scoped to the caller's own session just to identify them, one
// service-role to re-verify their real role server-side — the client's
// own claim is never trusted), and — matching extract-order-file/
// check-engraving-text — a raw `fetch` for the third-party API rather
// than an SDK, since Deno's Web Crypto (`crypto.subtle`) already covers
// the RS256 JWT signing a Google service-account flow needs, with no
// npm:googleapis dependency.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || !['store_admin', 'admin'].includes(callerProfile?.role ?? '')) {
    return jsonResponse({ error: 'Only Store Admin or Admin can sync an urgent order to the sheet.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId : '';
  if (!orderId) return jsonResponse({ error: 'Order ID is required.' }, 400);
  const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
  const amount = typeof body.amount === 'number' ? body.amount : Number(body.amount) || 0;
  const salesman = typeof body.salesman === 'string' ? body.salesman : '';
  const school = typeof body.school === 'string' ? body.school : '';
  const shipmentDate = typeof body.shipmentDate === 'string' ? body.shipmentDate : '';
  const functionDate = typeof body.functionDate === 'string' ? body.functionDate : '';
  const datePlaced = typeof body.datePlaced === 'string' ? body.datePlaced : '';

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken();
  } catch (err) {
    console.error('Google OAuth failed:', err);
    return jsonResponse({ error: 'Could not authenticate with Google Sheets. Please try again.' }, 502);
  }

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_RANGE)}:append?valueInputOption=USER_ENTERED`;
  const appendResp = await fetch(appendUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: [[
        orderId, invoiceId, amount, salesman, school,
        shipmentDate, functionDate, datePlaced, new Date().toISOString(),
      ]],
    }),
  });
  if (!appendResp.ok) {
    const errBody = await appendResp.text();
    console.error('Google Sheets append failed:', appendResp.status, errBody);
    return jsonResponse({ error: 'Could not write to the tracking sheet. Please try again.' }, 502);
  }

  return jsonResponse({ ok: true });
});
