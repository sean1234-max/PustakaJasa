// Reads the MASTER LIST's Form Responses before the website posts an order (Sean, 2026-11-10): salesmen kept
// filling the Google Form by hand while the website started filling it too, so an order already there (same
// school + same QTY in the last DUPLICATE_DAYS) is not posted again. Rows the website posted itself (school
// ending "(W)") don't count — google_form_fills already stops one order being posted twice.
// Google auth: the service account of sync-urgent-order-sheet (GOOGLE_SHEETS_CLIENT_EMAIL / _PRIVATE_KEY);
// the MASTER LIST must be shared with that email (Viewer is enough).

export const WEBSITE_MARK = '(W)';
const MASTER_LIST_ID = '1YDKnCokb13iLjjZN30CPqtDlfxrPbGur2hBR3_5A6wA';
const RESPONSES_RANGE = "'Form Responses 1'!A2:H";
const DUPLICATE_DAYS = 60;
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30); // a Sheets date serial counts days from here

export type ResponseRow = (string | number)[]; // A Timestamp, B ORDER DATE, C DUE, D FUNC, E SALE, F SCHOOL, G REMARK, H QTY
export type Duplicate = { row: number; school: string; qty: number };

const schoolKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/\(W\)\s*$/, '').replace(/[^A-Z0-9]/g, '');

// The first recent hand-filled row for this school and QTY (row = its sheet row number), else null
export function findDuplicate(rows: ResponseRow[], school: string, qty: number, now = Date.now()): Duplicate | null {
  const key = schoolKey(school);
  const since = now - DUPLICATE_DAYS * 86_400_000;
  for (let i = rows.length - 1; i >= 0; i--) {
    const [stamp, , , , , rowSchool, , rowQty] = rows[i];
    if (String(rowSchool ?? '').trim().toUpperCase().endsWith(WEBSITE_MARK)) continue;
    const at = typeof stamp === 'number' ? SHEETS_EPOCH_MS + stamp * 86_400_000 : NaN;
    if (!Number.isNaN(at) && at < since) continue;
    if (schoolKey(rowSchool) === key && Number(rowQty) === qty) return { row: i + 2, school: String(rowSchool), qty };
  }
  return null;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64json = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));

async function accessToken(): Promise<string> {
  const email = Deno.env.get('GOOGLE_SHEETS_CLIENT_EMAIL');
  const pem = Deno.env.get('GOOGLE_SHEETS_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!email || !pem) throw new Error('Google service account not set');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const input = `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json(claims)}`;
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${base64url(sig)}` }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

// Throws when the sheet can't be read — the caller then doesn't post (a duplicate is worse than a retry)
export async function readResponses(): Promise<ResponseRow[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_LIST_ID}/values/${encodeURIComponent(RESPONSES_RANGE)}`
    + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`MASTER LIST read: ${res.status} ${await res.text()}`);
  return (await res.json()).values ?? [];
}
