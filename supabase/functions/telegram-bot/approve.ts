// Approve from Telegram (Sean, 2026-11-27; migration 0134). ReviewAgent's "reviewed — please approve" reminder
// in a salesman's own group (remind.ts) carries ✅ Approve:
//   ✅ Approve  → "Shipment Date dd/mm/yyyy (Wed) ⚠️ URGENT — right?" CONFIRM / NOT CONFIRM (the website's question)
//   NOT CONFIRM → "the new day?" — his reply read by shipDate.ts (28 / today / 2/12/2026 …), each reading asked
//                 YES / NO (2/12 vs 12/2: the nearer one first); no day yet / after the Function Date: asked too
//   CONFIRM / YES → bot_approve_order: approved as it stands, only the Shipment Date may change (prices /
//                 Function Date / remark: the website)
//   then, for an order the Google Form takes: "Ketua Panitia?" → "<school> (W) - <his words>" — a reply, the
//   order's own Ketua Panitia (button), or nothing (fill-google-form's bot action: the website popup's fill)
// Only the order's own salesman (his linked Telegram) may press or answer. No AI.
// Buttons ("<step>:<order id>"): ap start, apc CONFIRM, apn NOT CONFIRM, apy / apx YES / NO to a day,
// apk the order's Ketua Panitia, apg Google Form without words.

import { db, SUPABASE_URL } from './db.ts';
import { esc } from './telegram.ts';
import { tr, langOfProfile } from './i18n.ts';
import { shipmentDayOptions } from './shipDate.ts';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://pustaka-jasa.vercel.app';
const JOB_KEY = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}')['default'] ?? '';
const URGENT_DAYS = 7;   // the website's URGENT_WINDOW_DAYS (urgentOrder.js)
const MY_OFFSET_MS = 8 * 3_600_000;
const WEBSITE_MARK = '(W)';

type Bot = {
  ask: (chatId: number | string, replyTo: number | null, html: string, buttons?: [string, string][][]) => Promise<number | null>;
  answerButton: (callbackId: string, note?: string) => Promise<void>;
  dropButtons: (chatId: number | string, messageId: number) => Promise<void>;
};
type Msg = Record<string, any>;
type T = (en: string, zh: string) => string;
type Order = {
  id: string; sekolah: string | null; status: string; reviewed_at: string | null; cancelled_at: string | null;
  salesman_id: string | null; shipment_date: string | null; function_date: string | null; items: any[] | null;
  total_amount: number | null; parent_order_id: string | null; created_by_salesman: string | null; created_by_production: string | null;
  ketua_panitia: string | null;
};
const ORDER_FIELDS = 'id, sekolah, status, reviewed_at, cancelled_at, salesman_id, shipment_date, function_date, items, total_amount, parent_order_id, created_by_salesman, created_by_production, ketua_panitia';

export const salesOrderLink = (id: string) => `${SITE_URL}/#/sales/orders/${encodeURIComponent(id)}`;
const dayOf = (s: string | null) => (s && /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : null);
const showDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const WEEKDAYS: [string, string][] = [['Sun', '星期日'], ['Mon', '星期一'], ['Tue', '星期二'], ['Wed', '星期三'], ['Thu', '星期四'], ['Fri', '星期五'], ['Sat', '星期六']];
// "<b>02/12/2026</b> (Wed) ⚠️ URGENT (within 7 days)"
function dayHtml(day: string, t: T) {
  const [en, zh] = WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];
  const urgent = isUrgentDay(day, myToday());
  return `<b>${showDate(day)}</b> (${t(en, zh)})${urgent ? ` ⚠️ <b>URGENT</b> ${t('(within 7 days)', '（7 天内）')}` : ''}`;
}
const myToday = (now = Date.now()) => new Date(now + MY_OFFSET_MS).toISOString().slice(0, 10);
export const isUrgentDay = (ship: string, today: string) => (Date.parse(ship) - Date.parse(today)) / 86_400_000 < URGENT_DAYS;
const waitingApproval = (o: Order) => o.status === 'Reviewing Order' && !!o.reviewed_at && !o.cancelled_at;
const takesGoogleForm = (o: Order) => !!(o.parent_order_id || o.created_by_salesman || o.created_by_production);

// The reminder's lines about the order and its buttons (remind.ts)
export function approvalLines(o: Pick<Order, 'items' | 'total_amount' | 'shipment_date' | 'function_date'>, t: T) {
  const pcs = (o.items || []).reduce((n, it) => n + (Number(it?.qty) || 0), 0);
  const ship = dayOf(o.shipment_date);
  const func = dayOf(o.function_date);
  return [
    `${t(`${pcs} pcs`, `${pcs} 块`)} · RM ${Number(o.total_amount || 0).toFixed(2)}`,
    `${t('Shipment', '出货')}: ${ship ? showDate(ship) : t('not set', '还没有')}${func ? ` · Function: ${showDate(func)}` : ''}`,
  ];
}
export const approvalButtons = (orderId: string, t: T): [string, string][][] => [[
  [t('✅ Approve', '✅ Approve'), `ap:${orderId}`],
  [t('🌐 Open on the website', '🌐 在网站打开'), salesOrderLink(orderId)],
]];

export async function handleApproveButton(cb: Msg, bot: Bot) {
  const m = /^(ap|apc|apn|apy|apx|apk|apg):(ORD-\d+)$/.exec(String(cb.data || ''));
  if (!m) return bot.answerButton(cb.id);
  const [, step, orderId] = m;
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  const { data } = await db.from('orders').select(ORDER_FIELDS).eq('id', orderId).maybeSingle();
  const o = data as Order | null;
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(cb.from?.id)).maybeSingle();
  const t = tr(await langOfProfile(db, link?.profile_id ?? o?.salesman_id));
  if (!o || !link || link.profile_id !== o.salesman_id) return bot.answerButton(cb.id, t('Only the order\'s salesman can do this.', '只有这张单的 salesman 可以按。'));
  const salesmanId = link.profile_id as string;

  // the Google Form, after approving: the order's own Ketua Panitia, or no words
  if (step === 'apk' || step === 'apg') {
    await bot.answerButton(cb.id);
    await bot.dropButtons(chatId, msgId);
    await db.from('bot_approvals').update({ gform_message_id: null }).eq('order_id', o.id);
    return bot.ask(chatId, msgId, await fillGoogleForm(o.id, step === 'apk' ? String(o.ketua_panitia || '') : '', t));
  }
  if (!waitingApproval(o)) {
    await bot.dropButtons(chatId, msgId);
    return bot.answerButton(cb.id, t(`Not waiting for approval — it is ${o.status} now.`, `这张单现在是 ${o.status}，不用 approve。`));
  }
  await bot.answerButton(cb.id);
  await bot.dropButtons(chatId, msgId);
  const ship = dayOf(o.shipment_date);
  const func = dayOf(o.function_date);

  if (step === 'ap') {
    // no day yet, or one after the Function Date: straight to "which day?"
    if (!ship || (func && ship > func)) {
      const why = !ship ? t('No Shipment Date yet.', '还没有出货日期。') : t('The Shipment Date is after the Function Date.', '出货日期比 Function Date 还迟。');
      return askNewDate(bot, o, salesmanId, chatId, msgId, t, why);
    }
    return bot.ask(chatId, msgId, [
      `${esc(o.id)} · ${esc(o.sekolah)}`,
      `${t('Shipment Date', '出货日期')}: ${dayHtml(ship, t)}`,
      t('Is this right?', '对吗？'),
    ].join('\n'), [[['✅ CONFIRM', `apc:${o.id}`], ['✖ NOT CONFIRM', `apn:${o.id}`]]]);
  }
  if (step === 'apn') return askNewDate(bot, o, salesmanId, chatId, msgId, t, '');
  if (step === 'apc') return approve(bot, o, salesmanId, chatId, msgId, t, null);

  // apy / apx: YES / NO to the day his reply was read as
  const { data: a } = await db.from('bot_approvals').select('date_options').eq('order_id', o.id).maybeSingle();
  const options = (a?.date_options as string[] | null) || [];
  if (!options.length) return askNewDate(bot, o, salesmanId, chatId, msgId, t, '');
  if (step === 'apy') {
    await db.from('bot_approvals').update({ date_options: null }).eq('order_id', o.id);
    return approve(bot, o, salesmanId, chatId, msgId, t, options[0]);
  }
  const rest = options.slice(1);
  if (!rest.length) return askNewDate(bot, o, salesmanId, chatId, msgId, t, t('OK, not that day.', '好，不是那天。'));
  return askDay(bot, o, chatId, msgId, t, rest);
}

// "Which day then?" — answered by a reply (handleApprovalReply)
async function askNewDate(bot: Bot, o: Order, salesmanId: string, chatId: number, replyTo: number | null, t: T, why: string) {
  const askId = await bot.ask(chatId, replyTo, [
    ...(why ? [why] : []),
    `${esc(o.id)} · ${esc(o.sekolah)}`,
    t('What is the new <b>Shipment Date</b>? <b>Reply to this message</b> — e.g. 28, today, 2/12/2026.', '新的<b>出货日期</b>是？<b>回复这条讯息</b>打日期 — 例如 28、今天、2/12/2026。'),
  ].join('\n'));
  await db.from('bot_approvals').upsert({ order_id: o.id, salesman_id: salesmanId, chat_id: chatId, date_message_id: askId, date_options: null });
}

// "Is it <day>?" YES / NO — the first of `options`
async function askDay(bot: Bot, o: Order, chatId: number, replyTo: number | null, t: T, options: string[]) {
  await db.from('bot_approvals').update({ date_message_id: null, date_options: options }).eq('order_id', o.id);
  return bot.ask(chatId, replyTo, `${t('New Shipment Date', '新的出货日期')}: ${dayHtml(options[0], t)}\n${t('Is it this day?', '是这天吗？')}`,
    [[['✅ YES', `apy:${o.id}`], ['✖ NO', `apx:${o.id}`]]]);
}

// bot_approve_order, then the Google Form's Ketua Panitia
async function approve(bot: Bot, o: Order, salesmanId: string, chatId: number, replyTo: number | null, t: T, newDay: string | null) {
  const website = `👉 <a href="${salesOrderLink(o.id)}">${esc(o.id)}</a>`;
  const { data: status, error } = await db.rpc('bot_approve_order', { p_order_id: o.id, p_salesman: salesmanId, p_shipment_date: newDay });
  if (error) return bot.ask(chatId, replyTo, `❌ ${esc(error.message)}\n${website}`);
  await bot.ask(chatId, replyTo, `✅ <b>${esc(o.id)}</b> ${t('approved', '已经 approve')} — ${esc(status)}${newDay ? ` · ${t('Shipment', '出货')} ${showDate(newDay)}` : ''}`);
  if (!takesGoogleForm(o)) return;
  const kp = String(o.ketua_panitia || '').trim();
  const askId = await bot.ask(chatId, null, [
    `📝 Google Form: <b>${esc(`${o.sekolah || ''} ${WEBSITE_MARK}`.trim())} - ?</b>`,
    t('Who is the <b>Ketua Panitia</b> (e.g. PK1 / kurikulum / PKP)? <b>Reply to this message</b>.', '<b>Ketua Panitia</b> 是什么（例如 PK1 / kurikulum / PKP）？<b>回复这条讯息</b>打字。'),
  ].join('\n'), [[
    ...(kp ? [[`✅ ${kp.slice(0, 40)}`, `apk:${o.id}`] as [string, string]] : []),
    [t('Leave it empty', '不用加'), `apg:${o.id}`],
  ]]);
  await db.from('bot_approvals').upsert({ order_id: o.id, salesman_id: salesmanId, chat_id: chatId, date_message_id: null, date_options: null, gform_message_id: askId, approved_at: new Date().toISOString() });
}

// His reply to one of the bot's questions: the new Shipment Date, or the Ketua Panitia for the Google Form
// ("<school> (W) - <his words>"). True when it was one.
export async function handleApprovalReply(msg: Msg, bot: Bot) {
  const replyTo = Number(msg.reply_to_message?.message_id);
  const text = String(msg.text ?? '').trim();
  if (!replyTo || !text) return false;
  const { data: a } = await db.from('bot_approvals').select('order_id, salesman_id, date_message_id, gform_message_id')
    .eq('chat_id', msg.chat.id).or(`date_message_id.eq.${replyTo},gform_message_id.eq.${replyTo}`).maybeSingle();
  if (!a) return false;
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(msg.from?.id)).maybeSingle();
  if (link?.profile_id !== a.salesman_id) return true; // someone else answering: not his
  const t = tr(await langOfProfile(db, a.salesman_id));

  if (Number(a.gform_message_id) === replyTo) {
    await db.from('bot_approvals').update({ gform_message_id: null }).eq('order_id', a.order_id);
    await bot.dropButtons(msg.chat.id, replyTo);
    await bot.ask(msg.chat.id, msg.message_id, await fillGoogleForm(a.order_id, text, t));
    return true;
  }
  const { data } = await db.from('orders').select(ORDER_FIELDS).eq('id', a.order_id).maybeSingle();
  const o = data as Order | null;
  if (!o || !waitingApproval(o)) {
    await db.from('bot_approvals').update({ date_message_id: null }).eq('order_id', a.order_id);
    await bot.ask(msg.chat.id, msg.message_id, t('This order is not waiting for approval any more.', '这张单已经不用 approve 了。'));
    return true;
  }
  const today = myToday();
  const read = shipmentDayOptions(text, today);
  const func = dayOf(o.function_date);
  const options = read.filter((d) => !func || d <= func);
  if (!options.length) {
    const why = !read.length
      ? t('I can\'t read that day (or it has passed).', '看不懂这个日期（或者已经过了）。')
      : t(`That is after the Function Date (${showDate(func!)}).`, `这天比 Function Date（${showDate(func!)}）还迟。`);
    await askNewDate(bot, o, a.salesman_id, msg.chat.id, msg.message_id, t, why);
    return true;
  }
  await askDay(bot, o, msg.chat.id, msg.message_id, t, options);
  return true;
}

// fill-google-form's bot action; one line for the salesman about it
async function fillGoogleForm(orderId: string, note: string, t: T) {
  let res: Record<string, any> = {};
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/fill-google-form`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-job-key': JOB_KEY },
      body: JSON.stringify({ action: 'bot', orderId, note }),
    });
    res = await r.json().catch(() => ({}));
  } catch (err) {
    console.error('fill-google-form (bot) failed:', err);
  }
  return googleFormLine(res, orderId, t);
}

export function googleFormLine(res: Record<string, any>, orderId: string, t: T) {
  const website = `<a href="${salesOrderLink(orderId)}">${esc(orderId)}</a>`;
  if (res.already) return t('📝 Already in the Google Form.', '📝 Google Form 之前已经填过了。');
  switch (res.status) {
    case 'filled': return t('📝 Google Form filled.', '📝 Google Form 填好了。');
    case 'bot': return t('📝 Google Form was filled when the order was submitted.', '📝 Google Form 交单时已经填了。');
    case 'no_due_date': return t('📝 Google Form waits for the Shipment / Function Date — it is filled once both are set.', '📝 Google Form 要等出货日期和 Function Date 都有了才会填。');
    case 'duplicate': return t(
      `📝 Already in the Google Form (row ${res.duplicate?.row}: ${esc(res.duplicate?.school)}, QTY ${res.duplicate?.qty}) — not filled again. To fill it anyway: ${website}`,
      `📝 Google Form 里已经有（第 ${res.duplicate?.row} 行：${esc(res.duplicate?.school)}，QTY ${res.duplicate?.qty}）— 没有再填。一定要填的话上网站：${website}`);
    case 'no_sale': return t('📝 Your name is not a SALE option in the Google Form — please fill it by hand.', '📝 Google Form 的 SALE 选项里没有你的名字 — 请手动填。');
    case 'failed': return t('⚠️ Google Form not filled yet — it is tried again by itself in a few minutes.', '⚠️ Google Form 还没填到 — 几分钟后会自动再试。');
    default: return t(`⚠️ Google Form not filled — please fill it by hand (${esc(res.status || 'no answer')}).`, `⚠️ Google Form 没填到 — 请手动填（${esc(res.status || '没有回应')}）。`);
  }
}
