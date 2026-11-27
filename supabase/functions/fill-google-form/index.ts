// Fills the salesmen's Google Form ("2026/27 MASTER LIST PRODUCTION ORDER") for an order a salesman submitted on
// the website (Sean, 2026-11-10) — the bot's orders already fill it (telegram-bot/orderChat.ts). Called by the
// website after the salesman's Submit Order, again when he approves it (the Shipment Date may only be set then),
// and when he approves an add-on (the Tambahan: the original's school / dates, its own QTY).
// REMARK is always SALES; QTY every plaque but selempang. google_form_fills (0122) keeps one row per order, so
// a filled order is never posted twice. A look-alike row already in the MASTER LIST stops the post ('duplicate')
// until the salesman says to fill it anyway (`force`, Sean 2026-11-16) — only a 'duplicate' reopens that way.
// Google not answering (2026-11-23): a 'failed' form fill and a Done Typing column I that couldn't be written
// (master_list_typed, 0127) are tried again by pg_cron every 10 minutes (`action: 'retry'`), RETRY_MAX times.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { findDuplicate, findTypedRow, googleFetch, markTyped, readResponses, WEBSITE_MARK } from './masterList.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLISHABLE_KEY = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default'];
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];

// The form itself — the same as telegram-bot/googleForm.ts (an Edge Function can't import another's folder
// when deployed alone): change both together.
const FORM_ID = '1FAIpQLSe9LDZNUphh4ffHC8HORdijc45NIi6ElSXQ5UAS2Zc15z4JQA';
const ENTRY = {
  orderDate: 'entry.779603213', dueDate: 'entry.1941679288', funcDate: 'entry.665772085', sale: 'entry.2092685616',
  school: 'entry.964230243', remark: 'entry.2122719593', qty: 'entry.1995587922',
};
const SALE_OPTIONS = ['ADAM', 'AINA', 'BONG', 'CY', 'JOEY', 'GSF', 'FIDA', 'FOO', 'HARRIET', 'JOYCE', 'KENT E', 'MAGGIE', 'NAZRIN', 'REX',
  'WENDY', 'LAWRENCE', 'KEITH', 'SHOPEE', 'PUSTAKA BERJAYA', 'EHSAN DIDIK', 'ALL INSAN', 'J&E', 'BNN', 'CHAN N NGOI', 'PEMBEKAL SAHABAT ABADI',
  'CASH', 'EDUPRO ENTERPRISE', 'G&L MARKETING', 'Z&C MARKETING', 'GSBC', 'JK ENTERPRISE', 'FKY', 'GUOH STATIONERY', 'ONN'];
const REMARK = 'SALES';
const MAX_NOTE = 60;
const DONE = ['filled', 'bot', 'no_sale', 'duplicate', 'timeout']; // never tried again ('timeout': may be in already)
const RETRY_MAX = 12;            // tries in all: the first + 11 retries, 10 minutes apart (about 2 hours)
const RETRY_WITHIN_DAYS = 2;     // older failures are left for a person
const RETRY_PER_RUN = 5;         // of each kind per cron run
const RETRY_RUN_MS = 90_000;     // stop starting new ones after this (the function has ~150 s)
const RETRY_QUIET_MS = 3 * 60_000; // a typed mark this fresh may still be running in the website's own call

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9&]/g, '');
function saleOption(name: string | null | undefined): string | null {
  const n = norm(name);
  if (!n) return null;
  const exact = SALE_OPTIONS.find((o) => norm(o) === n);
  if (exact) return exact;
  const first = norm(String(name).trim().split(/\s+/)[0]);
  const starts = SALE_OPTIONS.filter((o) => norm(o.split(/\s+/)[0]) === first);
  return starts.length === 1 ? starts[0] : null;
}
const formQty = (items: { jenisPlak?: string; qty?: unknown }[]) =>
  (items || []).filter((it) => String(it.jenisPlak).toUpperCase() !== 'SELEMPANG').reduce((n, it) => n + (Number(it.qty) || 0), 0);

// A stored day ("2026-11-20T00:00:00+08:00") as the form's YYYY-MM-DD, in Malaysia
const myDay = (v: string | null | undefined) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(d);
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// The month as the MASTER LIST writes it: "NOV", in Malaysia
const myMonth = () => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date()).toUpperCase();

// Done Typing: the order's row (a Tambahan's: its original's school) with this invoice's QTY, I still empty
// (findTypedRow) gets "<NAME> (<MON>)". Kept in master_list_typed first, so a call Google never answers is
// tried again (retryAll). -> { status: 'marked', row, school, text } | { status: 'not_found' | 'failed' }
// deno-lint-ignore no-explicit-any
async function markOrderTyped(admin: any, orderId: string, qty: number, name: string) {
  if (!/^ORD-\d+$/.test(orderId) || !Number.isInteger(qty) || qty <= 0) return { status: 'failed', error: 'bad order or QTY' };
  const text = `${String(name).trim().toUpperCase()} (${myMonth()})`;
  const { data: job, error } = await admin.from('master_list_typed')
    .insert({ order_id: orderId, qty, text, status: 'pending' }).select('id, order_id, qty, text, tries').single();
  if (error || !job) return { status: 'failed', error: String(error?.message || 'no such order') };
  return await tryTyped(admin, job);
}

// One try of a master_list_typed job; its row records the outcome (only 'failed' is tried again)
// deno-lint-ignore no-explicit-any
async function tryTyped(admin: any, job: { id: number; order_id: string; qty: number; text: string; tries: number }) {
  const save = (status: string, error: string | null = null) => admin.from('master_list_typed')
    .update({ status, error, tries: job.tries + 1, updated_at: new Date().toISOString() }).eq('id', job.id);
  const { data: order } = await admin.from('orders').select('id, sekolah, parent_order_id').eq('id', job.order_id).maybeSingle();
  if (!order) { await save('not_found', 'no such order'); return { status: 'failed', error: 'no such order' }; }
  let school = order.sekolah || '';
  if (order.parent_order_id) {
    const { data: parent } = await admin.from('orders').select('sekolah').eq('id', order.parent_order_id).maybeSingle();
    school = parent?.sekolah || school;
  }
  try {
    const hit = findTypedRow(await readResponses(true), school, job.qty);
    if (!hit) { await save('not_found'); return { status: 'not_found', school, qty: job.qty }; }
    await markTyped(hit.row, job.text);
    await save('marked');
    return { status: 'marked', row: hit.row, school: hit.school, qty: job.qty, text: job.text };
  } catch (err) {
    console.error('MASTER LIST typed mark failed:', err);
    const error = String((err as Error)?.message || err);
    await save('failed', error.slice(0, 500));
    return { status: 'failed', error };
  }
}

// pg_cron, every 10 minutes (0127): the failures of the last RETRY_WITHIN_DAYS, RETRY_PER_RUN of each kind.
// Works only from the saved rows, so it needs no caller.
// deno-lint-ignore no-explicit-any
async function retryAll(admin: any) {
  const stopAt = Date.now() + RETRY_RUN_MS;
  const since = new Date(Date.now() - RETRY_WITHIN_DAYS * 86_400_000).toISOString();
  const quiet = new Date(Date.now() - RETRY_QUIET_MS).toISOString();
  const done: Record<string, string>[] = [];
  const { data: typed } = await admin.from('master_list_typed').select('id, order_id, qty, text, tries')
    .in('status', ['pending', 'failed']).lt('tries', RETRY_MAX).gte('created_at', since).lt('updated_at', quiet)
    .order('created_at').limit(RETRY_PER_RUN);
  for (const job of typed ?? []) {
    if (Date.now() > stopAt) break;
    const res = await tryTyped(admin, job);
    done.push({ order: job.order_id, kind: 'typed', status: res.status });
  }
  const { data: forms } = await admin.from('google_form_fills').select('order_id, note, tries')
    .eq('status', 'failed').lt('tries', RETRY_MAX).gte('filled_at', since).order('filled_at').limit(RETRY_PER_RUN);
  for (const f of forms ?? []) {
    if (Date.now() > stopAt) break;
    const res = await fillForm(admin, f.order_id, f.note || '', false, (f.tries ?? 1) + 1);
    done.push({ order: f.order_id, kind: 'form', status: String(res.status) });
  }
  if (done.length) console.log('retry:', JSON.stringify(done));
  return { status: 'retried', done };
}

const cleanNote = (v: unknown) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* no body */ }
  if (body.action === 'retry') return json(await retryAll(createClient(SUPABASE_URL, SECRET_KEY)));
  // ReviewAgent after a salesman approved in Telegram (telegram-bot approve.ts, Sean 2026-11-27): the same fill
  // as his website popup; only the bot knows the secret key it sends
  if (body.action === 'bot') {
    if (req.headers.get('x-job-key') !== SECRET_KEY) return json({ error: 'forbidden' }, 403);
    const botOrderId = String(body.orderId || '');
    if (!/^ORD-\d+$/.test(botOrderId)) return json({ error: 'Bad orderId.' }, 400);
    return json(await fillForm(createClient(SUPABASE_URL, SECRET_KEY), botOrderId, cleanNote(body.note), false));
  }
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
  const caller = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not signed in.' }, 401);
  const admin = createClient(SUPABASE_URL, SECRET_KEY);
  const { data: profile } = await admin.from('profiles').select('role, status, display_name').eq('id', user.id).single();

  // Production's Done Typing (Sean, 2026-11-16): column I of the order's MASTER LIST row = "<NAME> (<MON>)"
  if (body.action === 'typed') {
    if (profile?.role !== 'production' || profile?.status !== 'active') return json({ status: 'not_production' });
    return json(await markOrderTyped(admin, String(body.orderId || ''), Number(body.qty), profile.display_name || user.email || ''));
  }

  if (profile?.role !== 'salesman' || profile?.status !== 'active') return json({ status: 'not_salesman' });
  const orderId = String(body.orderId || '');
  const force = body.force === true; // "YES, FILL AGAIN" after a look-alike row was found
  // the salesman's words after "<school> (W) -" (GoogleFormSchoolModal)
  const note = cleanNote(body.note);
  if (!/^ORD-\d+$/.test(orderId)) return json({ error: 'Bad orderId.' }, 400);
  return json(await fillForm(admin, orderId, note, force));
});

// The salesman's order into the Google Form (see the top). `tries`: this is that many-th try (retryAll).
// deno-lint-ignore no-explicit-any
async function fillForm(admin: any, orderId: string, note: string, force: boolean, tries = 1): Promise<Record<string, unknown>> {
  const { data: done } = await admin.from('google_form_fills').select('status').eq('order_id', orderId).maybeSingle();
  const refill = force && done?.status === 'duplicate';
  if (done && DONE.includes(done.status) && !refill) return { status: done.status, already: true };

  const cols = 'id, sekolah, sales, shipment_date, function_date, items, created_by_salesman, created_by_production, parent_order_id, status';
  const { data: order } = await admin.from('orders').select(cols).eq('id', orderId).maybeSingle();
  if (!order || order.status === 'Cancelled') return { status: 'no_order' };
  // the bot's own orders fill the form themselves
  const { data: botRun } = await admin.from('bot_order_sessions').select('order_id').eq('order_id', orderId).limit(1);
  if (botRun?.length) {
    await admin.from('google_form_fills').upsert({ order_id: orderId, status: 'bot' });
    return { status: 'bot' };
  }
  // an original: only one a salesman submitted himself, or Production keyed in for him (0125) — a teacher's
  // order isn't filled; a Tambahan: any
  let base = order;
  if (order.parent_order_id) {
    const { data: parent } = await admin.from('orders').select(cols).eq('id', order.parent_order_id).maybeSingle();
    if (!parent) return { status: 'no_order' };
    base = parent;
  } else if (!order.created_by_salesman && !order.created_by_production) {
    return { status: 'teacher_order' };
  }

  const values = {
    orderDate: myDay(new Date().toISOString()), dueDate: myDay(base.shipment_date), funcDate: myDay(base.function_date),
    sale: saleOption(base.sales), school: [`${base.sekolah || ''} ${WEBSITE_MARK}`.trim(), note].filter(Boolean).join(' - '), remark: REMARK, qty: formQty(order.items),
  };
  let status: string;
  if (!values.sale) status = 'no_sale';
  else if (!values.dueDate || !values.funcDate) status = 'no_due_date'; // tried again when he approves
  else {
    // already filled by hand (same school + QTY)? then not again. Unreadable sheet: not posted, tried again later.
    let dup = null;
    try {
      if (!refill) dup = findDuplicate(await readResponses(), base.sekolah || '', values.qty);
    } catch (err) {
      console.error('MASTER LIST not readable, form not posted:', err);
      await admin.from('google_form_fills').upsert({ order_id: orderId, status: 'failed', qty: values.qty, note, tries, filled_at: new Date().toISOString() });
      return { status: 'failed', values };
    }
    if (dup) {
      await admin.from('google_form_fills').upsert({ order_id: orderId, status: 'duplicate', qty: values.qty, note, tries, filled_at: new Date().toISOString() });
      return { status: 'duplicate', duplicate: dup, values };
    }
    const body = new URLSearchParams();
    for (const [k, entry] of Object.entries(ENTRY)) body.set(entry, String(values[k as keyof typeof values] ?? ''));
    body.set('fvv', '1');
    body.set('pageHistory', '0');
    status = 'failed';
    try {
      // not repeated after a timeout: that post may have gone through (googleFetch)
      const res = await googleFetch(`https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en' }, body, redirect: 'follow',
      }, false);
      const page = await res.text().catch(() => '');
      if (res.ok && (/response has been recorded/i.test(page) || !/FB_PUBLIC_LOAD_DATA_/.test(page))) status = 'filled';
      else console.error('Google Form refused the post:', res.status);
    } catch (err) {
      // no answer: it may have gone in, and the duplicate scan skips the website's own "(W)" rows, so never
      // posted again by itself — the salesman checks the MASTER LIST ('timeout')
      console.error('Google Form post failed:', err);
      status = 'timeout';
    }
  }
  await admin.from('google_form_fills').upsert({ order_id: orderId, status, qty: values.qty, note, tries, filled_at: new Date().toISOString() });
  return { status, values, formUrl: `https://docs.google.com/forms/d/e/${FORM_ID}/viewform` };
}
