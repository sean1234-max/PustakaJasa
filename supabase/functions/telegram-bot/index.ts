// Production's Telegram bot (Sean, 2026-11-05) — the team's group only. Since 2026-11-05 the group is
// Sean and the bots, so every message is for it (no @ needed):
//   • a salesman's message (pasted, or replied to) → the Shipment Date / Function Date / Remark changes
//     it asks for, as a preview. Production applies them on the order page (Apply / Dismiss), with the
//     website's own functions; this bot never changes an order. Quantities / wording are listed as
//     not handled.
//   • a file (PDF, Word, Excel, picture) with an order number → how it differs from that order.
//   • "summary <day>" → every order placed that day (no AI).
//   • anything else → Sean's assistant (assistant.ts): questions about orders, his to-do list, change
//     requests typed in his own words.
// Requests are kept in bot_requests (migration 0107).
//
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, ANTHROPIC_API_KEY. Set up once: open this function with
// ?setup=1 — it registers itself as the bot's webhook (Telegram then signs each call with a secret
// derived from the token). telegram-notify keeps sending the review notices; this only answers.
//
// The form bot (form.ts) is a second Telegram bot on this same function: TELEGRAM_FORM_BOT_TOKEN,
// webhook ?bot=form (set up with ?setup=1&bot=form).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { esc, telegramBot, MAX_FILE_BYTES } from './telegram.ts';
import { formBot, handleForm } from './form.ts';
import { readFile } from './files.ts';
import { askedDay, orderPlaquesText, proposeChanges, type Order } from './order.ts';
import { readChanges, compareFile } from './ai.ts';
import { askAssistant, type ChangeRequest } from './assistant.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRET_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default'];
const CHAT_ID = Deno.env.get('TELEGRAM_CHAT_ID') ?? '';
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const BOT_NAME = (Deno.env.get('TELEGRAM_BOT_USERNAME') ?? 'PjsbReviewAgent').toLowerCase();

const db = createClient(SUPABASE_URL, SECRET_KEY);
const bot = telegramBot(Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '');
const ORDER_ID_RE = /\bORD-?\s?(\d{3,5})\b/i;
const MAX_DIFFS_SHOWN = 25;

const orderLink = (id: string) => `<a href="${SITE_URL}/#/production/orders/${encodeURIComponent(id)}">${esc(id)}</a>`;
const normOrderId = (raw: string) => { const m = ORDER_ID_RE.exec(raw); return m ? `ORD-${m[1].padStart(4, '0')}` : ''; };
const todayMy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur' }).format(new Date());
const showDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const FIELD_LABEL: Record<string, string> = { shipmentDate: 'Shipment Date', functionDate: 'Function Date', remark: 'Remark' };

const HELP = [
  'Just talk to me in this group:',
  '• Ask anything about the orders — <b>where is ORD-0234?</b>, <b>how many orders from SK TAMAN MELAWATI this month?</b>',
  '• <b>remember me: 1. help Harriet convert the Excel</b> — I keep your to-do list; <b>my list</b>, <b>1 done</b>.',
  '• Forward a salesman\'s message — I read the Shipment Date / Function Date / Remark changes and you Apply them on the order page.',
  '• Send a file (PDF, Word, Excel, picture) with <b>check ORD-0234</b> — I compare it with that order.',
  '• <b>summary 4/11</b> — every order placed that day.',
  '• Every morning I report the day ahead, every evening what was done, and I ask you when an order looks stuck.',
].join('\n');
const HELP_RE = /^\s*(\/?help|\/start|what can you do\b.*|apa (yang )?(boleh|awak boleh) (buat|tolong)\b.*|你(能|可以|会)做(什么|甚么).*|你会什么.*)\s*[?？]?\s*$/i;

type Msg = Record<string, any>;

async function aiAllowed() {
  const { data, error } = await db.rpc('ai_budget_status');
  return error || !(Array.isArray(data) && data[0]?.blocked === true);
}

// ------------------------------------------------------------------ change requests
async function handleChanges(msg: Msg, text: string, who: string) {
  const read = await readChanges(text, todayMy());
  if (!read) return bot.reply(msg.chat.id, msg.message_id, 'Sorry, I couldn\'t read that message. Please try again.');
  const blocks = await changeBlocks((read.input.requests as ChangeRequest[]) || [], (read.input.notHandled as string[]) || [], text, who);
  if (!blocks.length) blocks.push(`I didn't find a Shipment Date, Function Date or Remark change with an order number (ORD-xxxx).\n\n${HELP}`);
  return bot.reply(msg.chat.id, msg.message_id, blocks.join('\n\n'));
}

// The change previews (saved in bot_requests for Apply on the order page), one block per order
async function changeBlocks(asked: ChangeRequest[], notHandled: string[], text: string, who: string) {
  const blocks: string[] = [];
  for (const r of asked) {
    const orderId = normOrderId(String(r.orderId || ''));
    if (!orderId) continue;
    const { data: order } = await db.from('orders').select('id, sekolah, status, shipment_date, function_date, remark').eq('id', orderId).maybeSingle();
    if (!order) { blocks.push(`❓ ${esc(orderId)} — no such order.`); continue; }
    const { changes, refused } = proposeChanges(order as Order, r as Record<string, string | null>);
    const lines = [`📝 ${orderLink(orderId)} ${esc(order.sekolah)}`];
    for (const c of changes) {
      lines.push(c.field === 'remark'
        ? `Remark + "${esc(c.to.slice(c.from.length).trim())}"`
        : `${FIELD_LABEL[c.field]}: ${showDate(c.from)} → <b>${showDate(c.to)}</b>`);
    }
    refused.forEach((x) => lines.push(`⚠ ${esc(x)}`));
    if (changes.length) {
      await db.from('bot_requests').insert({ kind: 'change', order_id: orderId, requested_by: who, source_text: text.slice(0, 4000), changes });
      lines.push('👉 Open the order and press <b>Apply</b>');
    } else if (!refused.length) {
      lines.push('Nothing to change — it already says that.');
    }
    blocks.push(lines.join('\n'));
  }
  if (notHandled.length) blocks.push(['⚠ Not done by the bot — change these in Edit Order:', ...notHandled.map((n) => `• ${esc(n)}`)].join('\n'));
  return blocks;
}

// ------------------------------------------------------------------ file compare
const KIND_ICON: Record<string, string> = { missing_in_order: '❌ In the file, not in the order', extra_in_order: '➕ In the order, not in the file', wording: '✏️ Different words', quantity: '🔢 Different quantity', other: '• Other' };

async function handleCompare(msg: Msg, fileMsg: Msg, text: string, who: string) {
  const orderId = normOrderId(text);
  if (!orderId) return bot.reply(msg.chat.id, msg.message_id, 'Which order? Add the order number, e.g. <b>@PjsbReviewAgent check ORD-0234</b>');
  const doc = fileMsg.document;
  const photo = Array.isArray(fileMsg.photo) ? fileMsg.photo[fileMsg.photo.length - 1] : null;
  const file = doc || photo;
  const fileName = doc?.file_name || 'photo.jpg';
  if ((file.file_size || 0) > MAX_FILE_BYTES) return bot.reply(msg.chat.id, msg.message_id, 'That file is too big for me (20 MB at most).');
  const { data: order } = await db.from('orders').select('id, sekolah, items').eq('id', orderId).maybeSingle();
  if (!order) return bot.reply(msg.chat.id, msg.message_id, `${esc(orderId)} — no such order.`);
  const content = readFile(await bot.downloadFile(file.file_id), fileName);
  if (!content) return bot.reply(msg.chat.id, msg.message_id, `I can't read "${esc(fileName)}" — send a PDF, Word (.docx), Excel or a picture.`);
  await bot.reply(msg.chat.id, msg.message_id, `🔍 Comparing ${esc(fileName)} with ${orderLink(orderId)}… (about a minute)`);

  const result = await compareFile(content, fileName, orderId, orderPlaquesText(order.items || []));
  if (!result) return bot.reply(msg.chat.id, msg.message_id, 'Sorry, I couldn\'t compare that file. Please try again.');
  const diffs = (result.input.differences as Record<string, string>[]) || [];
  await db.from('bot_requests').insert({ kind: 'compare', order_id: orderId, requested_by: who, source_text: fileName, result: result.input, status: 'done' });
  const lines = [`🔍 ${orderLink(orderId)} ${esc(order.sekolah)} vs ${esc(fileName)}`, esc(result.input.summary)];
  for (const kind of Object.keys(KIND_ICON)) {
    const ofKind = diffs.filter((d) => d.kind === kind);
    if (!ofKind.length) continue;
    lines.push('', `<b>${KIND_ICON[kind]}</b>`);
    ofKind.slice(0, MAX_DIFFS_SHOWN).forEach((d) => {
      const both = [d.inFile && `file: ${esc(d.inFile)}`, d.inOrder && `order: ${esc(d.inOrder)}`].filter(Boolean).join(' · ');
      lines.push(`• ${esc(d.where)}${both ? ` — ${both}` : ''}`);
    });
    if (ofKind.length > MAX_DIFFS_SHOWN) lines.push(`… and ${ofKind.length - MAX_DIFFS_SHOWN} more`);
  }
  if (!diffs.length) lines.push('', '✅ No differences found.');
  return bot.reply(msg.chat.id, msg.message_id, lines.join('\n'));
}

// ------------------------------------------------------------------ day summary
// "@PjsbReviewAgent summary 4/11" → every order placed that Malaysian day (Sean 2026-11-05). Straight from
// the database — no AI.
// only a message that starts with it — "what's on my list today" is a question for the assistant
const SUMMARY_RE = /^\s*(summary|summarise|summarize|senarai)\b/i;
const MAX_MESSAGE_CHARS = 3800; // Telegram's limit is 4096
const rm = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function handleSummary(msg: Msg, day: string) {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const { data, error } = await db.from('orders')
    .select('id, sekolah, sales, status, total_amount, parent_order_id, cancelled_at')
    .gte('created_at', `${day}T00:00:00+08:00`).lt('created_at', `${next}T00:00:00+08:00`)
    .order('created_at');
  if (error) throw error;
  const orders = data || [];
  const live = orders.filter((o) => !o.cancelled_at);
  const total = live.reduce((a, o) => a + Number(o.total_amount || 0), 0);
  const head = `📋 <b>Orders placed on ${showDate(day)}</b> — ${live.length} order(s), ${rm(total)}${orders.length > live.length ? ` (${orders.length - live.length} cancelled)` : ''}`;
  const rows = orders.map((o) => [
    `${o.cancelled_at ? '❌' : '•'} ${orderLink(o.id)} ${esc(o.sekolah)}`,
    o.sales && `(${esc(o.sales)})`,
    `— ${rm(Number(o.total_amount || 0))} · ${esc(o.cancelled_at ? 'Cancelled' : o.status)}`,
    o.parent_order_id && `· Tambahan of ${esc(o.parent_order_id)}`,
  ].filter(Boolean).join(' '));
  const lines = [head, ''];
  for (const [i, row] of rows.entries()) {
    if (lines.join('\n').length + row.length > MAX_MESSAGE_CHARS) { lines.push(`… and ${rows.length - i} more`); break; }
    lines.push(row);
  }
  if (!orders.length) lines.push('No orders were placed that day.');
  return bot.reply(msg.chat.id, msg.message_id, lines.join('\n'));
}

// ------------------------------------------------------------------ routing
// The assistant's plain-text answer for Telegram's HTML, order numbers as links
const assistantHtml = (text: string) => esc(text).replace(/\bORD-\d{4,5}\b/g, (id) => orderLink(id));

async function handle(msg: Msg) {
  if (msg.from?.is_bot) return;
  const raw = String(msg.text ?? msg.caption ?? '');
  const own = raw.replace(new RegExp(`@${BOT_NAME}`, 'ig'), '').trim();
  const repliedTo = msg.reply_to_message as Msg | undefined;
  const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';
  const quoted = String(repliedTo?.text ?? repliedTo?.caption ?? '');
  // a file of this message, or the file it replies to when it names an order ("check ORD-0234")
  const fileMsg = msg.document || msg.photo ? msg : (repliedTo?.document || repliedTo?.photo) && normOrderId(own) ? repliedTo : null;
  if (!own && !fileMsg) return raw ? bot.reply(msg.chat.id, msg.message_id, HELP) : undefined;
  if (!fileMsg && HELP_RE.test(own) && !ORDER_ID_RE.test(own)) return bot.reply(msg.chat.id, msg.message_id, HELP);
  const summaryDay = !fileMsg && SUMMARY_RE.test(own) ? askedDay(own, todayMy()) : '';
  if (summaryDay) return handleSummary(msg, summaryDay);
  if (!(await aiAllowed())) return bot.reply(msg.chat.id, msg.message_id, 'The AI budget for this month is used up — please do this one by hand.');
  if (fileMsg) return handleCompare(msg, fileMsg, [own, quoted].filter(Boolean).join('\n\n'), who);
  // a forwarded salesman's message: its date / Remark changes, as before
  if (msg.forward_origin || msg.forward_date) return handleChanges(msg, own, who);

  const reply = await askAssistant({
    db, today: todayMy(), who,
    proposeChanges: async (requests, notHandled) => {
      const blocks = await changeBlocks(requests, notHandled, own, who);
      if (!blocks.length) return 'nothing to post: no order number or no Shipment Date / Function Date / Remark change';
      await bot.reply(msg.chat.id, msg.message_id, blocks.join('\n\n'));
      return `posted the preview: ${blocks.length} block(s); Production presses Apply on the order page`;
    },
  }, quoted ? `${own}\n\n(replying to this message: "${quoted.slice(0, 1500)}")` : own);
  return bot.reply(msg.chat.id, msg.message_id, assistantHtml(reply));
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // ?bot=form: the form bot's webhook (form.ts); otherwise the review bot's
  const isForm = url.searchParams.get('bot') === 'form';
  const which = isForm ? formBot : bot;
  if (url.searchParams.get('setup') === '1') {
    return Response.json(await which.setWebhook(`${SUPABASE_URL}/functions/v1/telegram-bot${isForm ? '?bot=form' : ''}`));
  }
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await which.webhookSecret()) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => null);
  const msg = update?.message;
  if (!msg || (!isForm && String(msg.chat?.id) !== CHAT_ID)) return new Response('ok');
  // answer in the background — Telegram only waits for the 200
  const work = (isForm ? handleForm(msg, aiAllowed) : handle(msg)).catch(async (err) => {
    console.error('telegram-bot failed:', err);
    await which.reply(msg.chat.id, msg.message_id, 'Sorry, something went wrong. Please try again.').catch(() => {});
  });
  // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work); else await work;
  return new Response('ok');
});
