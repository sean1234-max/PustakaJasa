// Telegram notices for Production (Sean, 2026-11-04): a message in the team's group when an order
// comes in for review, and one review list a day — every order in Reviewing Order, ✅ once Done
// Review — edited in place whenever it changes (migration 0108; it replaced the 9:00 summary).
// Since 2026-11-05 also Sean's morning report, evening summary and questions (reports.ts).
// Called every 3 minutes by pg_cron; each run sends only what hasn't been sent yet (telegram_sent),
// so an extra call does nothing. No caller auth for that reason.
//
// Secrets (Supabase → Edge Functions → Secrets): TELEGRAM_BOT_TOKEN (from @BotFather) and
// TELEGRAM_CHAT_ID (the group). To find the group's id: add the bot to the group, send any message
// there, then open this function with ?find=1 — it lists the chats the bot has seen.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { runReports } from './reports.ts';
import { reviewMark, REVIEW_MARKS_LEGEND } from './reviewMarks.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];
const TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
// Sean's reports come from his assistant bot (telegram-bot ?bot=assistant), the review bot until it's set
const ASSISTANT_TOKEN = Deno.env.get('TELEGRAM_ASSISTANT_BOT_TOKEN') || TOKEN;
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';

const MAX_NEW_PER_RUN = 10;         // a backlog arrives over a few runs, not as a flood
const LIST_SHOWN = 40;              // per part of the list: a Telegram message holds 4096 characters
const MS_PER_DAY = 86_400_000;

const db = createClient(SUPABASE_URL, SECRET_KEY);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;

// Malaysia's calendar day and hour, whatever the server's clock (memory: always Malaysia time)
function malaysiaNow(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

async function telegram(method: string, payload: Record<string, unknown>, token = TOKEN) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, parse_mode: 'HTML', disable_web_page_preview: true, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, body };
}

// the new message's id
async function send(text: string, silent = false, token = TOKEN): Promise<number> {
  const { ok, body } = await telegram('sendMessage', { text, disable_notification: silent }, token);
  if (!ok) throw new Error(`Telegram sendMessage: ${String(body.description).slice(0, 300)}`);
  return body.result.message_id;
}

// false when the message is gone (deleted, auto-deleted) or too old to edit
async function edit(messageId: number, text: string) {
  const { ok, body } = await telegram('editMessageText', { message_id: messageId, text });
  return ok || /not modified/i.test(String(body.description));
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

// Every order in Reviewing Order — the ones already Done Review (waiting for the salesman to approve)
// too, ticked in the review list (Sean, 2026-11-05)
async function reviewingOrders() {
  const { data, error } = await db.from('orders')
    .select('id, sekolah, sales, function_date, urgent, created_at, reviewed_at, items')
    .eq('status', 'Reviewing Order').is('cancelled_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  const orders = data ?? [];
  // ReviewAgent's own review of each (telegram-bot autoReview.ts), for the list's marks
  const { data: reviews } = orders.length
    ? await db.from('order_auto_reviews').select('order_id, status, issue_count, answered_at').in('order_id', orders.map((o) => o.id))
    : { data: [] };
  const byId = new Map((reviews ?? []).map((r) => [r.order_id, r]));
  return orders.map((o) => ({ ...o, autoReview: byId.get(o.id) }));
}

// ReviewAgent reviews the next order (telegram-bot ?job=review) — started, not waited for: one compare
// takes a minute or two, longer than this run should
function startJob(job: 'review' | 'approvals') {
  return fetch(`${SUPABASE_URL}/functions/v1/telegram-bot?job=${job}`, { method: 'POST', headers: { 'x-job-key': SECRET_KEY } })
    .then((r) => r.status)
    .catch((err) => { console.error(`${job} job start failed:`, err); return 0; });
}

function newOrderText(o: Record<string, unknown>) {
  return [
    `🆕 New order to review: ${orderLink(String(o.id))}${o.urgent ? ' 🔥 URGENT' : ''}`,
    `${esc(o.sekolah)}${o.sales ? ` · ${esc(o.sales)}` : ''}`,
    `${plaqueCount(o.items)} plaque(s)${o.function_date ? ` · Function ${esc(String(o.function_date).slice(0, 10))}` : ''}`,
  ].join('\n');
}

const waitedDays = (o: Record<string, unknown>) => Math.floor((Date.now() - new Date(String(o.created_at)).getTime()) / MS_PER_DAY);

// ❗ (Sean 2026-11-04): review has to be done by the day after the order is placed, so an order still
// waiting from an earlier Malaysia day is due — placed on the 4th, it gets ❗ from the 5th
const isDue = (o: Record<string, unknown>, today: string) => !o.reviewed_at && malaysiaNow(new Date(String(o.created_at))).day < today;

function listPart(orders: Record<string, unknown>[], icon: string, today: string) {
  return [
    ...orders.slice(0, LIST_SHOWN).map((o) => {
      const days = waitedDays(o);
      return `${icon}${isDue(o, today) ? '❗' : ''} ${orderLink(String(o.id))} ${esc(o.sekolah)}${o.sales ? ` · ${esc(o.sales)}` : ''}${o.urgent ? ' 🔥' : ''}${!o.reviewed_at && days > 0 ? ` — ${days}d` : ''}${o.reviewed_at ? '' : reviewMark(o.autoReview as Parameters<typeof reviewMark>[0])}`;
    }),
    ...(orders.length > LIST_SHOWN ? [`… and ${orders.length - LIST_SHOWN} more`] : []),
  ];
}

// The review list without its "updated" line — what decides whether it needs editing
function reviewListBody(orders: Record<string, unknown>[], today: string) {
  const waiting = orders.filter((o) => !o.reviewed_at);
  const done = orders.filter((o) => o.reviewed_at);
  const due = waiting.filter((o) => isDue(o, today)).length;
  return [
    `📋 <b>Review list</b> — ${waiting.length} to review${due ? ` (❗ ${due} due)` : ''}, ${done.length} done ✅`,
    '',
    ...(waiting.length ? listPart(waiting, '⏳', today) : ['Nothing waiting for review 🎉']),
    ...(done.length ? ['', ...listPart(done, '✅', today)] : []),
  ].join('\n');
}

async function sha256(text: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Today's review list: sent (quietly) once a day, then edited whenever an order comes, is reviewed or leaves
async function updateReviewList(orders: Record<string, unknown>[], now: { day: string; time: string }) {
  const key = `live:${now.day}`;
  const body = reviewListBody(orders, now.day);
  const hash = await sha256(body);
  const { data: row } = await db.from('telegram_sent').select('message_id, body_hash').eq('key', key).maybeSingle();
  if (row?.body_hash === hash) return false;
  const text = `${body}\n\n<i>Updated ${now.time} · ❗ = placed before today, review it today · ✅ = Done Review, waiting for the salesman to approve\n${REVIEW_MARKS_LEGEND}</i>`;
  if (row?.message_id && await edit(row.message_id, text)) {
    await db.from('telegram_sent').update({ body_hash: hash }).eq('key', key);
    return true;
  }
  const messageId = await send(text, true);
  await db.from('telegram_sent').upsert({ key, message_id: messageId, body_hash: hash });
  return true;
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
  // helper: how Telegram's deliveries to telegram-bot are going (no token in the answer);
  // &bot=assistant for the assistant bot. chat: whether TELEGRAM_CHAT_ID still is the group
  // (a group upgraded to a supergroup gets a new id)
  if (new URL(req.url).searchParams.get('webhook') === '1') {
    const token = new URL(req.url).searchParams.get('bot') === 'assistant' ? ASSISTANT_TOKEN : TOKEN;
    const call = async (method: string) => (await fetch(`https://api.telegram.org/bot${token}/${method}`)).json();
    const info = (await call('getWebhookInfo')).result ?? {};
    const me = (await call('getMe')).result ?? {};
    // getChat still answers for a group that was upgraded; a chat action (no message) says it moved
    const chat = await call(`getChat?chat_id=${encodeURIComponent(CHAT_ID)}`);
    const action = await call(`sendChatAction?chat_id=${encodeURIComponent(CHAT_ID)}&action=typing`);
    if (chat.ok && !action.ok) Object.assign(chat, { ok: false, description: action.description, parameters: action.parameters });
    return json({
      pending: info.pending_update_count, lastError: info.last_error_message ?? null, lastErrorAt: info.last_error_date ?? null,
      allowed: info.allowed_updates ?? null, readsAllGroupMessages: me.can_read_all_group_messages, username: me.username,
      chat: chat.ok ? { type: chat.result.type, title: chat.result.title } : { error: chat.description, migratedTo: chat.parameters?.migrate_to_chat_id ?? null },
    });
  }
  if (!CHAT_ID) return json({ ok: false, error: 'TELEGRAM_CHAT_ID is not set' });

  try {
    const review = startJob('review');
    // Done Review → the salesman reminded to approve, in his own group (telegram-bot remind.ts)
    const approvals = startJob('approvals');
    const orders = await reviewingOrders();
    let sentNew = 0;
    for (const o of orders.filter((x) => !x.reviewed_at)) {
      if (sentNew >= MAX_NEW_PER_RUN) break;
      if (await sendOnce(`new:${o.id}`, newOrderText(o))) sentNew++;
    }
    const now = malaysiaNow();
    const list = await updateReviewList(orders, now);
    // Sean's morning / evening reports and questions — their own failure doesn't stop the review list
    const reports = await runReports({ db, send: (html) => send(html, false, ASSISTANT_TOKEN), esc, orderLink }, now)
      .catch((err) => { console.error('telegram reports failed:', err); return [`failed: ${String(err).slice(0, 200)}`]; });
    return json({ ok: true, sentNew, list, reports, autoReview: await review, approvals: await approvals });
  } catch (err) {
    console.error('telegram-notify failed:', err);
    return json({ ok: false, error: String(err).slice(0, 300) }, 500);
  }
});
