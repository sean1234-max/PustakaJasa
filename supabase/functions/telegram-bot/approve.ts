// Approve from Telegram (Sean, 2026-11-27; migration 0134). ReviewAgent's "reviewed — please approve" reminder
// in a salesman's own group (remind.ts) carries ✅ Approve:
//   ✅ Approve → "Shipment Date dd/mm/yyyy (⚠️ URGENT) — right?" CONFIRM / NOT CONFIRM (the website's question)
//   CONFIRM    → bot_approve_order: the order approved as it stands (prices / dates / remark: the website)
//   then, for an order the Google Form takes, the school name: "<school> (W) -" + his reply, or "no words"
//   (fill-google-form's bot action — the same fill, duplicate check and retry as the website's popup)
// Only the order's own salesman (his linked Telegram) may press them. No AI.
// Buttons: "ap:" start, "apc:" CONFIRM, "apn:" NOT CONFIRM, "apg:" Google Form without words — then the order id.

import { db, SUPABASE_URL } from './db.ts';
import { esc } from './telegram.ts';
import { tr, langOfProfile } from './i18n.ts';

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
};
const ORDER_FIELDS = 'id, sekolah, status, reviewed_at, cancelled_at, salesman_id, shipment_date, function_date, items, total_amount, parent_order_id, created_by_salesman, created_by_production';

export const salesOrderLink = (id: string) => `${SITE_URL}/#/sales/orders/${encodeURIComponent(id)}`;
const dayOf = (s: string | null) => (s && /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : null);
const showDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const myToday = (now = Date.now()) => new Date(now + MY_OFFSET_MS).toISOString().slice(0, 10);
export const isUrgentDay = (ship: string, today: string) => (Date.parse(ship) - Date.parse(today)) / 86_400_000 < URGENT_DAYS;
const waitingApproval = (o: Order) => o.status === 'Reviewing Order' && !!o.reviewed_at && !o.cancelled_at;
const takesGoogleForm = (o: Order) => !!(o.parent_order_id || o.created_by_salesman || o.created_by_production);

// The reminder's lines about the order and its buttons (remind.ts)
export function approvalLines(o: Order, t: T) {
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
  const m = /^(ap|apc|apn|apg):(ORD-\d+)$/.exec(String(cb.data || ''));
  if (!m) return bot.answerButton(cb.id);
  const [, step, orderId] = m;
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;
  const { data } = await db.from('orders').select(ORDER_FIELDS).eq('id', orderId).maybeSingle();
  const o = data as Order | null;
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(cb.from?.id)).maybeSingle();
  const t = tr(await langOfProfile(db, link?.profile_id ?? o?.salesman_id));
  if (!o || !link || link.profile_id !== o.salesman_id) return bot.answerButton(cb.id, t('Only the order\'s salesman can do this.', '只有这张单的 salesman 可以按。'));
  const website = `👉 <a href="${salesOrderLink(o.id)}">${esc(o.id)}</a>`;

  if (step === 'apg') {
    await bot.answerButton(cb.id);
    await bot.dropButtons(chatId, msgId);
    await db.from('bot_approvals').update({ gform_message_id: null }).eq('order_id', o.id);
    return bot.ask(chatId, msgId, await fillGoogleForm(o.id, '', t));
  }
  if (!waitingApproval(o)) {
    await bot.dropButtons(chatId, msgId);
    return bot.answerButton(cb.id, t(`Not waiting for approval — it is ${o.status} now.`, `这张单现在是 ${o.status}，不用 approve。`));
  }
  await bot.answerButton(cb.id);
  await bot.dropButtons(chatId, msgId);
  const ship = dayOf(o.shipment_date);
  const func = dayOf(o.function_date);

  if (step === 'apn') return bot.ask(chatId, msgId, `${t('OK — change the Shipment Date on the website, then approve there.', '好 — 请上网站改出货日期，再在网站 approve。')}\n${website}`);
  if (!ship) return bot.ask(chatId, msgId, `${t('No Shipment Date yet — pick it on the website and approve there.', '还没有出货日期 — 请上网站选日期，再在网站 approve。')}\n${website}`);
  if (func && ship > func) return bot.ask(chatId, msgId, `${t('The Shipment Date is after the Function Date — fix it on the website.', '出货日期比 Function Date 还迟 — 请上网站改。')}\n${website}`);

  if (step === 'ap') {
    const urgent = isUrgentDay(ship, myToday());
    return bot.ask(chatId, msgId, [
      `${esc(o.id)} · ${esc(o.sekolah)}`,
      `${t('Shipment Date', '出货日期')}: <b>${showDate(ship)}</b>${urgent ? ` ⚠️ <b>URGENT</b> ${t('(within 7 days)', '（7 天内）')}` : ''}`,
      t('Is this right?', '对吗？'),
    ].join('\n'), [[['✅ CONFIRM', `apc:${o.id}`], ['✖ NOT CONFIRM', `apn:${o.id}`]]]);
  }

  // apc: CONFIRM
  const { data: status, error } = await db.rpc('bot_approve_order', { p_order_id: o.id, p_salesman: link.profile_id });
  if (error) return bot.ask(chatId, msgId, `❌ ${esc(error.message)}\n${website}`);
  await bot.ask(chatId, msgId, `✅ <b>${esc(o.id)}</b> ${t('approved', '已经 approve')} — ${esc(status)}`);
  if (!takesGoogleForm(o)) return;
  const askId = await bot.ask(chatId, null, [
    `📝 Google Form ${t('school name', '学校名')}: <b>${esc(`${o.sekolah || ''} ${WEBSITE_MARK}`.trim())} -</b> …`,
    t('Words after the "-" (e.g. kokurikulum)? <b>Reply to this message</b> with them — or tap the button.', '"-" 后面要加字吗（例如 kokurikulum）？<b>回复这条讯息</b>打字；不用加就按下面的按钮。'),
  ].join('\n'), [[[t('No words — fill it', '不用加，直接填'), `apg:${o.id}`]]]);
  await db.from('bot_approvals').upsert({ order_id: o.id, salesman_id: link.profile_id, chat_id: chatId, gform_message_id: askId, approved_at: new Date().toISOString() });
}

// The salesman's reply to the Google Form question: his words after "<school> (W) -". True when it was one.
export async function handleApprovalReply(msg: Msg, bot: Bot) {
  const replyTo = msg.reply_to_message?.message_id;
  const text = String(msg.text ?? '').trim();
  if (!replyTo || !text) return false;
  const { data: a } = await db.from('bot_approvals').select('order_id, salesman_id').eq('chat_id', msg.chat.id).eq('gform_message_id', replyTo).maybeSingle();
  if (!a) return false;
  const { data: link } = await db.from('telegram_links').select('profile_id').eq('telegram_user_id', Number(msg.from?.id)).maybeSingle();
  if (link?.profile_id !== a.salesman_id) return true; // someone else answering: not his words
  const t = tr(await langOfProfile(db, a.salesman_id));
  await db.from('bot_approvals').update({ gform_message_id: null }).eq('order_id', a.order_id);
  await bot.dropButtons(msg.chat.id, replyTo);
  await bot.ask(msg.chat.id, msg.message_id, await fillGoogleForm(a.order_id, text, t));
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
