// Fills the salesmen's Google Form ("2026/27 MASTER LIST PRODUCTION ORDER") for an order a salesman submitted on
// the website (Sean, 2026-11-10) — the bot's orders already fill it (telegram-bot/orderChat.ts). Called by the
// website after the salesman's Submit Order, again when he approves it (the Shipment Date may only be set then),
// and when he approves an add-on (the Tambahan: the original's school / dates, its own QTY).
// REMARK is always SALES; QTY every plaque but selempang. google_form_fills (0122) keeps one row per order, so
// a filled order is never posted twice.

import { createClient } from 'npm:@supabase/supabase-js@2';

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
const DONE = ['filled', 'bot', 'no_sale']; // never tried again

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Missing Authorization header.' }, 401);
  const caller = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user) return json({ error: 'Not signed in.' }, 401);
  const admin = createClient(SUPABASE_URL, SECRET_KEY);
  const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).single();
  if (profile?.role !== 'salesman' || profile?.status !== 'active') return json({ status: 'not_salesman' });

  let orderId = '';
  try { orderId = String((await req.json()).orderId || ''); } catch { /* no body */ }
  if (!/^ORD-\d+$/.test(orderId)) return json({ error: 'Bad orderId.' }, 400);

  const { data: done } = await admin.from('google_form_fills').select('status').eq('order_id', orderId).maybeSingle();
  if (done && DONE.includes(done.status)) return json({ status: done.status, already: true });

  const cols = 'id, sekolah, sales, shipment_date, function_date, items, created_by_salesman, parent_order_id, status';
  const { data: order } = await admin.from('orders').select(cols).eq('id', orderId).maybeSingle();
  if (!order || order.status === 'Cancelled') return json({ status: 'no_order' });
  // the bot's own orders fill the form themselves
  const { data: botRun } = await admin.from('bot_order_sessions').select('order_id').eq('order_id', orderId).limit(1);
  if (botRun?.length) {
    await admin.from('google_form_fills').upsert({ order_id: orderId, status: 'bot' });
    return json({ status: 'bot' });
  }
  // an original: only one a salesman submitted himself (a teacher's order isn't filled); a Tambahan: any
  let base = order;
  if (order.parent_order_id) {
    const { data: parent } = await admin.from('orders').select(cols).eq('id', order.parent_order_id).maybeSingle();
    if (!parent) return json({ status: 'no_order' });
    base = parent;
  } else if (!order.created_by_salesman) {
    return json({ status: 'teacher_order' });
  }

  const values = {
    orderDate: myDay(new Date().toISOString()), dueDate: myDay(base.shipment_date), funcDate: myDay(base.function_date),
    sale: saleOption(base.sales), school: base.sekolah || '', remark: REMARK, qty: formQty(order.items),
  };
  let status: string;
  if (!values.sale) status = 'no_sale';
  else if (!values.dueDate || !values.funcDate) status = 'no_due_date'; // tried again when he approves
  else {
    const body = new URLSearchParams();
    for (const [k, entry] of Object.entries(ENTRY)) body.set(entry, String(values[k as keyof typeof values] ?? ''));
    body.set('fvv', '1');
    body.set('pageHistory', '0');
    status = 'failed';
    try {
      const res = await fetch(`https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en' }, body, redirect: 'follow',
      });
      const page = await res.text().catch(() => '');
      if (res.ok && (/response has been recorded/i.test(page) || !/FB_PUBLIC_LOAD_DATA_/.test(page))) status = 'filled';
      else console.error('Google Form refused the post:', res.status);
    } catch (err) {
      console.error('Google Form post failed:', err);
    }
  }
  await admin.from('google_form_fills').upsert({ order_id: orderId, status, qty: values.qty, filled_at: new Date().toISOString() });
  return json({ status, values, formUrl: `https://docs.google.com/forms/d/e/${FORM_ID}/viewform` });
});
