// Production's Telegram bot (Sean, 2026-11-05) — the team's group only, and only when it's mentioned
// (@PjsbReviewAgent) or replied to:
//   • a salesman's message (pasted, or replied to) → the Shipment Date / Function Date / Remark changes
//     it asks for, as a preview. Production applies them on the order page (Apply / Dismiss), with the
//     website's own functions; this bot never changes an order. Quantities / wording are listed as
//     not handled.
//   • a file (PDF, Word, Excel, picture) with an order number → how it differs from that order.
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
import { orderPlaquesText, proposeChanges, type Order } from './order.ts';
import { readChanges, compareFile } from './ai.ts';

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
  'Mention me in this group:',
  '• Reply to a salesman\'s message with <b>@PjsbReviewAgent</b> — I read the Shipment Date / Function Date / Remark changes and you Apply them on the order page.',
  '• Send a file (PDF, Word, Excel, picture) with <b>@PjsbReviewAgent check ORD-0234</b> — I compare it with that order.',
].join('\n');

type Msg = Record<string, any>;

async function aiAllowed() {
  const { data, error } = await db.rpc('ai_budget_status');
  return error || !(Array.isArray(data) && data[0]?.blocked === true);
}

// ------------------------------------------------------------------ change requests
async function handleChanges(msg: Msg, text: string, who: string) {
  const read = await readChanges(text, todayMy());
  if (!read) return bot.reply(msg.chat.id, msg.message_id, 'Sorry, I couldn\'t read that message. Please try again.');
  const asked = (read.input.requests as Record<string, string | null>[]) || [];
  const notHandled = (read.input.notHandled as string[]) || [];
  const blocks: string[] = [];
  for (const r of asked) {
    const orderId = normOrderId(String(r.orderId || ''));
    if (!orderId) continue;
    const { data: order } = await db.from('orders').select('id, sekolah, status, shipment_date, function_date, remark').eq('id', orderId).maybeSingle();
    if (!order) { blocks.push(`❓ ${esc(orderId)} — no such order.`); continue; }
    const { changes, refused } = proposeChanges(order as Order, r);
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
  if (!blocks.length) blocks.push(`I didn't find a Shipment Date, Function Date or Remark change with an order number (ORD-xxxx).\n\n${HELP}`);
  return bot.reply(msg.chat.id, msg.message_id, blocks.join('\n\n'));
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

// ------------------------------------------------------------------ routing
async function handle(msg: Msg) {
  const own = String(msg.text ?? msg.caption ?? '');
  const repliedTo = msg.reply_to_message as Msg | undefined;
  const mentioned = own.toLowerCase().includes(`@${BOT_NAME}`) || repliedTo?.from?.username?.toLowerCase() === BOT_NAME;
  if (!mentioned) return;
  const who = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || msg.from?.username || 'Telegram';
  const text = [own.replace(new RegExp(`@${BOT_NAME}`, 'ig'), '').trim(), repliedTo?.text ?? repliedTo?.caption ?? ''].filter(Boolean).join('\n\n');
  const fileMsg = msg.document || msg.photo ? msg : repliedTo?.document || repliedTo?.photo ? repliedTo : null;
  if (!text && !fileMsg) return bot.reply(msg.chat.id, msg.message_id, HELP);
  if (!(await aiAllowed())) return bot.reply(msg.chat.id, msg.message_id, 'The AI budget for this month is used up — please do this one by hand.');
  return fileMsg ? handleCompare(msg, fileMsg, text, who) : handleChanges(msg, text, who);
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
