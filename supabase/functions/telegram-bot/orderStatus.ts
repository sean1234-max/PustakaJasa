// "Where is my order?" in the form bot's private chat (Sean, 2026-11-27): a salesman types "查单" (the bot asks
// the invoice number), an invoice number, an order number or part of a school name, and gets each order's
// stage, Shipment Date and invoice —
// read from the database, no AI. A salesman sees only his own orders (form.ts lookupOrders). Plain, no imports
// but i18n's types — orderStatus.test.ts.

import type { Lang } from './i18n.ts';

export const MAX_FOUND = 5;
const MY_OFFSET_MS = 8 * 3_600_000;
const URGENT_DAYS = 7;

export type FoundOrder = {
  id: string; sekolah: string | null; status: string; reviewed_at: string | null; typed_at: string | null;
  shipment_date: string | null; function_date: string | null; invoice_id: string | null; urgent: boolean | null;
  total_amount: number | null; parent_order_id: string | null;
};
export const FOUND_FIELDS = 'id, sekolah, status, reviewed_at, typed_at, shipment_date, function_date, invoice_id, urgent, total_amount, parent_order_id';

const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const dayOf = (s: string | null) => (s && /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(0, 10) : null);
const showDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

// What the salesman typed (Sean, 2026-11-27: "check an order" → the bot asks the invoice number first):
//   "查单" / "check" / "semak" / "status"   → ask (the bot asks for the invoice number)
//   "DWI-26111377", "dwi 26111377", "26111377", "PJI-26100177" → invoice: its digits (prefixes and
//      separators vary in the database: DWI / PJI / PAI / DO, "-" / "_")
//   "ORD-0553", "ord 553"                   → orderId
//   a few words                             → words of a school name
// null = not a lookup (a sentence, Chinese, …)
export type Lookup = { ask: true } | { invoice: string } | { orderId: string } | { words: string[] };
const ASK_RE = /^(查单|查单号|查订单|check|check order|semak|semak order|status|order status|cek|查)$/i;
export function readLookup(text: string): Lookup | null {
  const t = String(text || '').trim();
  if (ASK_RE.test(t)) return { ask: true };
  let m = /^ord\s*-?\s*(\d{1,4})$/i.exec(t);
  if (m) return { orderId: `ORD-${m[1].padStart(4, '0')}` };
  m = /^(?:[a-z]{2,3}\s*[-_ ]?\s*)?(\d{5,9})$/i.exec(t);
  if (m) return { invoice: m[1] };
  // a sentence isn't a school name: a few words, letters / digits only
  const words = t.toUpperCase().replace(/[^A-Z0-9() ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !/^\(?[A-Z0-9]?\)?$/.test(w));
  if (!words.length || words.length > 6 || t.length > 60) return null;
  return { words };
}

// The order's stage in the salesman's words
export function stageText(o: FoundOrder, lang: Lang) {
  const t = (en: string, zh: string) => (lang === 'en' ? en : zh);
  switch (o.status) {
    case 'Reviewing Order': return o.reviewed_at
      ? t('✅ Reviewed — waiting for <b>your approval</b>', '✅ 已 review 好 — 等<b>你 approve</b>')
      : t('🔎 Production is reviewing it', '🔎 Production 审核中');
    case 'Salesman Approved': return t('🧾 Approved — waiting for the invoice', '🧾 已 approve — 等开 invoice');
    case 'In Production': return o.typed_at
      ? t('🏭 In production (typed, being made)', '🏭 生产中（已打好字，在做）')
      : t('⌨️ In production (waiting to be typed)', '⌨️ 生产中（等打字）');
    case 'Completed': return t('📦 Done / shipped', '📦 完成 / 已出货');
    case 'Cancelled': return t('✖ Cancelled', '✖ 已取消');
    default: return esc(o.status);
  }
}

// One order, a few lines
export function orderStatusHtml(o: FoundOrder, lang: Lang, link: string, now = Date.now()) {
  const t = (en: string, zh: string) => (lang === 'en' ? en : zh);
  const ship = dayOf(o.shipment_date);
  const func = dayOf(o.function_date);
  const today = new Date(now + MY_OFFSET_MS).toISOString().slice(0, 10);
  const late = ship && ship < today && !['Completed', 'Cancelled'].includes(o.status);
  const soon = ship && !late && (Date.parse(ship) - Date.parse(today)) / 86_400_000 < URGENT_DAYS && !['Completed', 'Cancelled'].includes(o.status);
  return [
    `📋 <a href="${link}">${esc(o.id)}</a> · ${esc(o.sekolah)}${o.parent_order_id ? ` · Tambahan (${esc(o.parent_order_id)})` : ''}`,
    stageText(o, lang),
    `${t('Shipment', '出货')}: ${ship ? `<b>${showDate(ship)}</b>${late ? ` ❗${t('passed', '已过')}` : soon ? ' ⚠️' : ''}` : t('not set', '还没有')}`
      + `${func ? ` · Function: ${showDate(func)}` : ''}${o.urgent ? ' · URGENT' : ''}`,
    `Invoice: ${o.invoice_id ? `<b>${esc(o.invoice_id)}</b>` : t('none yet', '还没有')} · RM ${Number(o.total_amount || 0).toFixed(2)}`,
  ].join('\n');
}
