// Telegram notices for Production (Sean, 2026-11-04): a message in the team's group when an order
// comes in for review, and a summary every morning of what is still waiting. Called every 5 minutes
// by pg_cron (migration 0106); each run sends only what hasn't been sent yet (telegram_sent), so an
// extra call does nothing. No caller auth for that reason.
//
// Secrets (Supabase → Edge Functions → Secrets): TELEGRAM_BOT_TOKEN (from @BotFather) and
// TELEGRAM_CHAT_ID (the group). To find the group's id: add the bot to the group, send any message
// there, then open this function with ?find=1 — it lists the chats the bot has seen.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';

const SUMMARY_HOUR_MY = 9;          // the morning summary goes out from 9:00 Malaysia time
const MAX_NEW_PER_RUN = 10;         // a backlog arrives over a few runs, not as a flood
const SUMMARY_OLDEST_SHOWN = 5;
const MS_PER_DAY = 86_400_000;

const db = createClient(SUPABASE_URL, SECRET_KEY);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;

// Malaysia's calendar day and hour, whatever the server's clock (memory: always Malaysia time)
function malaysiaNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

async function send(text: string) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

// sent once: a row in telegram_sent is written only after Telegram took the message
async function sendOnce(key: string, text: string) {
  const { data } = await db.from('telegram_sent').select('key').eq('key', key).maybeSingle();
  if (data) return false;
  await send(text);
  await db.from('telegram_sent').insert({ key });
  return true;
}

const plaqueCount = (items: unknown) => (Array.isArray(items) ? items : [])
  .reduce((n, it) => n + (Number((it as Record<string, unknown>)?.qty) || 0), 0);

async function pendingReviews() {
  const { data, error } = await db.from('orders')
    .select('id, sekolah, sales, function_date, urgent, created_at, items')
    .eq('status', 'Reviewing Order').is('reviewed_at', null).is('cancelled_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function newOrderText(o: Record<string, unknown>) {
  return [
    `🆕 New order to review: ${orderLink(String(o.id))}${o.urgent ? ' 🔥 URGENT' : ''}`,
    `${esc(o.sekolah)}${o.sales ? ` · ${esc(o.sales)}` : ''}`,
    `${plaqueCount(o.items)} plaque(s)${o.function_date ? ` · Function ${esc(String(o.function_date).slice(0, 10))}` : ''}`,
  ].join('\n');
}

function summaryText(orders: Record<string, unknown>[]) {
  if (orders.length === 0) return '☀️ Good morning — no orders waiting for review.';
  const days = (o: Record<string, unknown>) => Math.floor((Date.now() - new Date(String(o.created_at)).getTime()) / MS_PER_DAY);
  const oldest = orders.slice(0, SUMMARY_OLDEST_SHOWN).map((o) => `• ${orderLink(String(o.id))} ${esc(o.sekolah)} — waiting ${days(o)} day(s)`);
  return [`☀️ Good morning — ${orders.length} order(s) waiting for review. Oldest:`, ...oldest].join('\n');
}

Deno.serve(async (req) => {
  if (!TOKEN) return json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not set' });

  // helper for setting up: the chats the bot has seen (titles and ids only)
  if (new URL(req.url).searchParams.get('find') === '1') {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates`);
    const body = await res.json();
    const chats = new Map<string, string>();
    for (const u of body.result ?? []) {
      const chat = u.message?.chat ?? u.my_chat_member?.chat;
      if (chat) chats.set(String(chat.id), chat.title ?? chat.username ?? chat.first_name ?? '');
    }
    // ok / description: Telegram's own word when the token is wrong or nothing has come in
    return json({ ok: body.ok, description: body.description ?? null, chats: [...chats].map(([id, title]) => ({ id, title })) });
  }
  if (!CHAT_ID) return json({ ok: false, error: 'TELEGRAM_CHAT_ID is not set' });

  try {
    const orders = await pendingReviews();
    let sentNew = 0;
    for (const o of orders) {
      if (sentNew >= MAX_NEW_PER_RUN) break;
      if (await sendOnce(`new:${o.id}`, newOrderText(o))) sentNew++;
    }
    const now = malaysiaNow();
    const summary = now.hour >= SUMMARY_HOUR_MY && await sendOnce(`summary:${now.day}`, summaryText(orders));
    return json({ ok: true, sentNew, summary });
  } catch (err) {
    console.error('telegram-notify failed:', err);
    return json({ ok: false, error: String(err).slice(0, 300) }, 500);
  }
});
