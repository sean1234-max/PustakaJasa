// The salesmen's Google Form, "2026/27 MASTER LIST PRODUCTION ORDER" (Sean, 2026-11-10): every order is also
// entered there. ExcelFormAgent fills it right after it submits the order on the website. The form needs no
// sign-in, so it is posted like a person pressing Submit. No Telegram or database here.
// If the form's questions change, update ENTRY / SALE_OPTIONS / REMARK_OPTIONS (read from the live form).

import { tr, type Lang } from './i18n.ts';

export const FORM_ID = '1FAIpQLSe9LDZNUphh4ffHC8HORdijc45NIi6ElSXQ5UAS2Zc15z4JQA';
export const ENTRY = {
  orderDate: 'entry.779603213', dueDate: 'entry.1941679288', funcDate: 'entry.665772085', sale: 'entry.2092685616',
  school: 'entry.964230243', remark: 'entry.2122719593', qty: 'entry.1995587922',
};
export const SALE_OPTIONS = ['ADAM', 'AINA', 'BONG', 'CY', 'JOEY', 'GSF', 'FIDA', 'FOO', 'HARRIET', 'JOYCE', 'KENT E', 'MAGGIE', 'NAZRIN', 'REX',
  'WENDY', 'LAWRENCE', 'KEITH', 'SHOPEE', 'PUSTAKA BERJAYA', 'EHSAN DIDIK', 'ALL INSAN', 'J&E', 'BNN', 'CHAN N NGOI', 'PEMBEKAL SAHABAT ABADI',
  'CASH', 'EDUPRO ENTERPRISE', 'G&L MARKETING', 'Z&C MARKETING', 'GSBC', 'JK ENTERPRISE', 'FKY', 'GUOH STATIONERY', 'ONN'];
export const REMARK_OPTIONS = ['SALES', 'SUMBANGAN'];

const norm = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9&]/g, '');

// The website's salesman name → the form's SALE option: the same name (case and spaces ignored), else the one
// option starting with his first name ("Kent" → KENT E). null: not in the form (a test account) — not filled.
export function saleOption(name: string | null | undefined): string | null {
  const n = norm(name);
  if (!n) return null;
  const exact = SALE_OPTIONS.find((o) => norm(o) === n);
  if (exact) return exact;
  const first = norm(String(name).trim().split(/\s+/)[0]);
  const starts = SALE_OPTIONS.filter((o) => norm(o.split(/\s+/)[0]) === first);
  return starts.length === 1 ? starts[0] : null;
}

// The QTY the form wants: every plaque of the order, selempang left out
export const formQty = (items: { jenisPlak: string; qty: unknown }[]) =>
  items.filter((it) => String(it.jenisPlak).toUpperCase() !== 'SELEMPANG').reduce((n, it) => n + (Number(it.qty) || 0), 0);

export type FormValues = { orderDate: string; dueDate: string; funcDate: string; sale: string | null; school: string; remark: string; qty: number };

const dmy = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '—');

// What will go into the form, for the salesman to check
export function formPreviewHtml(v: FormValues, lang: Lang) {
  const t = tr(lang);
  const esc = (x: unknown) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    t('📝 <b>Google Form</b> — is this right?', '📝 <b>Google Form</b> — 对吗？'),
    `ORDER DATE: ${dmy(v.orderDate)}`,
    `DUE DATE: <b>${dmy(v.dueDate)}</b>`,
    `FUNC. DATE: ${dmy(v.funcDate)}`,
    `SALE: ${v.sale ? esc(v.sale) : t('— (not in the form: not filled)', '—（Form 没有这个名字：不会填）')}`,
    `SCHOOL: ${esc(v.school)}`,
    `REMARK: ${esc(v.remark)}`,
    `QTY: <b>${v.qty}</b>`,
  ].join('\n');
}

// The form's POST body (one page: pageHistory 0). Dates as YYYY-MM-DD, as the form's own date box sends them.
export function formBody(v: FormValues) {
  const body = new URLSearchParams();
  body.set(ENTRY.orderDate, v.orderDate);
  body.set(ENTRY.dueDate, v.dueDate);
  body.set(ENTRY.funcDate, v.funcDate);
  body.set(ENTRY.sale, v.sale || '');
  body.set(ENTRY.school, v.school);
  body.set(ENTRY.remark, v.remark);
  body.set(ENTRY.qty, String(v.qty));
  body.set('fvv', '1');
  body.set('pageHistory', '0');
  return body;
}

// Google's answer to a post: the "response recorded" page; a post it refused comes back as the form itself
// (its questions in FB_PUBLIC_LOAD_DATA_) or as an error status
export const formTookIt = (status: number, page: string) =>
  status >= 200 && status < 300 && (/response has been recorded/i.test(page) || !/FB_PUBLIC_LOAD_DATA_/.test(page));

/** Posts the form. true when Google took it; never throws. */
export async function submitGoogleForm(v: FormValues) {
  if (!v.sale || !v.dueDate || !v.funcDate) return false;
  try {
    const res = await fetch(`https://docs.google.com/forms/d/e/${FORM_ID}/formResponse`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'en' }, body: formBody(v), redirect: 'follow',
    });
    return formTookIt(res.status, await res.text().catch(() => ''));
  } catch (err) {
    console.error('Google Form post failed:', err);
    return false;
  }
}

// The values as text, for filling the form by hand when the post didn't go in
export function formValuesText(v: FormValues) {
  return [`ORDER DATE ${dmy(v.orderDate)}`, `DUE DATE ${dmy(v.dueDate)}`, `FUNC. DATE ${dmy(v.funcDate)}`, `SALE ${v.sale || '—'}`,
    `SCHOOL ${v.school}`, `REMARK ${v.remark}`, `QTY ${v.qty}`].join('\n');
}

// A DUE DATE typed for the form — it becomes the order's Shipment Date too, so the same rules: not before
// today, and the Function Date after it. null = fine.
export function dueDateProblem(due: string, today: string, functionDate: string, lang: Lang): string | null {
  const t = tr(lang);
  if (due < today) return t(`${dmy(due)} has already passed.`, `${dmy(due)} 已经过了。`);
  if (functionDate && functionDate <= due) return t(`It must be before the Function Date (${dmy(functionDate)}).`, `一定要比 Function Date（${dmy(functionDate)}）早。`);
  return null;
}

// A typed QTY: a whole number above 0
export const readQty = (text: string) => (/^\s*\d{1,5}\s*$/.test(text) && Number(text) > 0 ? Number(text) : null);
