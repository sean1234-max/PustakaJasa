// Reads the MASTER LIST's Form Responses before the website posts an order (Sean, 2026-11-10): salesmen kept
// filling the Google Form by hand while the website started filling it too, so an order already there (same
// school + same QTY in the last DUPLICATE_DAYS) is not posted again. Rows the website posted itself (school
// ending "(W)") don't count — google_form_fills already stops one order being posted twice.
// Google auth: the service account of sync-urgent-order-sheet (GOOGLE_SHEETS_CLIENT_EMAIL / _PRIVATE_KEY);
// the MASTER LIST is shared with that email as Editor — Done Typing writes column I (markTyped).

import { googleFetch } from '../_shared/googleFetch.ts';
export { googleFetch };

export const WEBSITE_MARK = '(W)';
const MASTER_LIST_ID = '1YDKnCokb13iLjjZN30CPqtDlfxrPbGur2hBR3_5A6wA';
const RESPONSES_SHEET = 'Form Responses 1';
const RESPONSES_RANGE = `'${RESPONSES_SHEET}'!A2:H`;
const TYPED_COL = 8; // I (0-based): who typed it and when, "IKIN (NOV)"
const TYPED_DAYS = 120; // Done Typing looks this far back for the order's row
const DUPLICATE_DAYS = 60;
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30); // a Sheets date serial counts days from here

export type ResponseRow = (string | number)[]; // A Timestamp, B ORDER DATE, C DUE, D FUNC, E SALE, F SCHOOL, G REMARK, H QTY, I TYPED
export type Duplicate = { row: number; school: string; qty: number };

// Hand-typed names differ ("Sk Hulu kelang kokurikulum" for SK HULU KELANG, Sean 2026-11-10): long forms are
// shortened, and one name containing the other counts as the same school.
const LONG_FORMS: [RegExp, string][] = [
  [/SEKOLAH JENIS KEBANGSAAN \(?C(INA)?\)?/g, 'SJKC'], [/SEKOLAH JENIS KEBANGSAAN \(?T(AMIL)?\)?/g, 'SJKT'],
  [/SEKOLAH MENENGAH KEBANGSAAN/g, 'SMK'], [/SEKOLAH KEBANGSAAN/g, 'SK'],
];
const MIN_KEY = 6; // shorter than "SKXXXX" is too vague to match inside another name
const schoolKey = (s: unknown) => LONG_FORMS
  .reduce((n, [re, short]) => n.replace(re, short), String(s ?? '').toUpperCase().replace(/\(W\)\s*$/, '').replace(/\s+/g, ' '))
  .replace(/[^A-Z0-9]/g, '');
const sameSchool = (a: string, b: string) => a === b || (a.length >= MIN_KEY && b.length >= MIN_KEY && (a.includes(b) || b.includes(a)));

// The first recent hand-filled row for this school and QTY (row = its sheet row number), else null
export function findDuplicate(rows: ResponseRow[], school: string, qty: number, now = Date.now()): Duplicate | null {
  const key = schoolKey(school);
  const since = now - DUPLICATE_DAYS * 86_400_000;
  for (let i = rows.length - 1; i >= 0; i--) {
    const [stamp, , , , , rowSchool, , rowQty] = rows[i];
    if (String(rowSchool ?? '').trim().toUpperCase().endsWith(WEBSITE_MARK)) continue;
    const at = typeof stamp === 'number' ? SHEETS_EPOCH_MS + stamp * 86_400_000 : NaN;
    if (!Number.isNaN(at) && at < since) continue;
    if (Number(rowQty) === qty && sameSchool(schoolKey(rowSchool), key)) return { row: i + 2, school: String(rowSchool), qty };
  }
  return null;
}

// Done Typing (Sean, 2026-11-16): the order's row — same school (as findDuplicate compares, the website's own "(W)"
// rows too) and QTY, column I still empty, in the last TYPED_DAYS — the earliest one, so an invoice split in two
// with the same QTY takes the two rows in turn. null when there's none.
// ponytail: a Done Typing undone and done again can take a second identical row; rare, Production fixes it by hand
export function findTypedRow(rows: ResponseRow[], school: string, qty: number, now = Date.now()): Duplicate | null {
  const key = schoolKey(school);
  const since = now - TYPED_DAYS * 86_400_000;
  for (let i = 0; i < rows.length; i++) {
    const [stamp, , , , , rowSchool, , rowQty] = rows[i];
    if (String(rows[i][TYPED_COL] ?? '').trim() !== '') continue;
    const at = typeof stamp === 'number' ? SHEETS_EPOCH_MS + stamp * 86_400_000 : NaN;
    if (!Number.isNaN(at) && at < since) continue;
    if (Number(rowQty) === qty && sameSchool(schoolKey(rowSchool), key)) return { row: i + 2, school: String(rowSchool), qty };
  }
  return null;
}

const base64url = (bytes: Uint8Array) =>btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64json = (o: unknown) => base64url(new TextEncoder().encode(JSON.stringify(o)));

const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
async function accessToken(scope = READ_SCOPE): Promise<string> {
  const email = Deno.env.get('GOOGLE_SHEETS_CLIENT_EMAIL');
  const pem = Deno.env.get('GOOGLE_SHEETS_PRIVATE_KEY')?.replace(/\\n/g, '\n');
  if (!email || !pem) throw new Error('Google service account not set');
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const input = `${b64json({ alg: 'RS256', typ: 'JWT' })}.${b64json(claims)}`;
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input)));
  const res = await googleFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${base64url(sig)}` }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`Google token: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

// Throws when the sheet can't be read — the caller then doesn't post (a duplicate is worse than a retry)
// `withTyped`: through column I too (Done Typing)
export async function readResponses(withTyped = false): Promise<ResponseRow[]> {
  const range = withTyped ? `'${RESPONSES_SHEET}'!A2:I` : RESPONSES_RANGE;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_LIST_ID}/values/${encodeURIComponent(range)}`
    + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
  const res = await googleFetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`MASTER LIST read: ${res.status} ${await res.text()}`);
  return (await res.json()).values ?? [];
}

// Column I of `row` (its sheet row number) = text, with a border all round and centred, like the rows typed by
// hand (Sean, 2026-11-16). Throws when Google refuses.
export async function markTyped(row: number, text: string): Promise<void> {
  const token = await accessToken(WRITE_SCOPE);
  const api = `https://sheets.googleapis.com/v4/spreadsheets/${MASTER_LIST_ID}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const cell = `'${RESPONSES_SHEET}'!I${row}`;
  const put = await googleFetch(`${api}/values/${encodeURIComponent(cell)}?valueInputOption=RAW`, {
    method: 'PUT', headers, body: JSON.stringify({ range: cell, values: [[text]] }),
  });
  if (!put.ok) throw new Error(`MASTER LIST write: ${put.status} ${await put.text()}`);
  const meta = await googleFetch(`${api}?fields=sheets.properties(sheetId,title)`, { headers });
  if (!meta.ok) throw new Error(`MASTER LIST sheets: ${meta.status} ${await meta.text()}`);
  const sheetId = ((await meta.json()).sheets ?? []).find((sh: { properties: { title: string } }) => sh.properties.title === RESPONSES_SHEET)?.properties.sheetId;
  if (sheetId === undefined) throw new Error(`no "${RESPONSES_SHEET}" sheet`);
  const range = { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: TYPED_COL, endColumnIndex: TYPED_COL + 1 };
  const solid = { style: 'SOLID' };
  const fmt = await googleFetch(`${api}:batchUpdate`, {
    method: 'POST', headers, body: JSON.stringify({ requests: [
      { updateBorders: { range, top: solid, bottom: solid, left: solid, right: solid } },
      { repeatCell: { range, cell: { userEnteredFormat: { horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(horizontalAlignment,verticalAlignment)' } },
    ] }),
  });
  if (!fmt.ok) throw new Error(`MASTER LIST format: ${fmt.status} ${await fmt.text()}`);
}
