// ExcelFormAgent's order Submit (Sean, 2026-11-07) — the parts with no Telegram or database in them:
// what to ask next, reading an answer, the summary, and the order row the website's own New Order would
// insert. The chat itself is orderChat.ts.

import type { DraftFields } from './orderDraft.ts';

export type Details = DraftFields & {
  schoolType?: 'SK' | 'NOT_SK' | '';
  logoUrl?: string; logoName?: string; logoRemark?: string; remark?: string;
};
export type FileRef = { fileId: string; name: string };
export type School = { id: string; sekolah: string; schoolLanguage: string };
export type Session = {
  id: string; details: Details; school: School | null; excel: FileRef | null; kertas_kerja: FileRef[];
  kertas_asked: boolean; answers: Record<string, any>; subs: { from: string; to: string; whole?: boolean }[];
  ok_words: { blockKey: string; word: string }[];
};

export const FIELD_LABEL: Record<string, string> = {
  sekolah: 'Sekolah', picName: 'Cikgu', phone: 'Phone', ketuaPanitia: 'Ketua Panitia', terms: 'Terms',
  shipmentDate: 'Shipment Date', functionDate: 'Function Date', logoRemark: 'Logo remark',
};
// The website's Function Details rule (NewOrderStep1.jsx): at least 4 days from today, today included
export const FUNCTION_MIN_DAYS = 3;

export const addDaysIso = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PHONE_RE = /^[0-9-]{7,}$/;

export type Step =
  | { kind: 'school' } | { kind: 'field'; field: 'picName' | 'phone' | 'ketuaPanitia' | 'functionDate' | 'shipmentDate' | 'logoRemark'; why?: string }
  | { kind: 'terms' } | { kind: 'schoolType' } | { kind: 'logo' } | { kind: 'excel' } | { kind: 'kertas' };

// What the order still needs before the FORM ANUGERAH is read, in the order Function Details asks it
export function nextDetailStep(s: Session, today: string): Step | null {
  const d = s.details;
  if (!s.school) return { kind: 'school' };
  if (!d.picName?.trim()) return { kind: 'field', field: 'picName' };
  if (!PHONE_RE.test(d.phone || '')) return { kind: 'field', field: 'phone', ...(d.phone ? { why: `"${d.phone}" isn't a phone number.` } : {}) };
  if (!d.ketuaPanitia?.trim()) return { kind: 'field', field: 'ketuaPanitia' };
  if (!d.terms) return { kind: 'terms' };
  const minDay = addDaysIso(today, FUNCTION_MIN_DAYS);
  if (!d.functionDate) return { kind: 'field', field: 'functionDate' };
  if (d.functionDate < minDay) return { kind: 'field', field: 'functionDate', why: `${showDay(d.functionDate)} is too soon — the Function Date must be ${showDay(minDay)} or later.` };
  if (d.shipmentDate && d.shipmentDate > d.functionDate) return { kind: 'field', field: 'shipmentDate', why: `The Shipment Date (${showDay(d.shipmentDate)}) is after the Function Date (${showDay(d.functionDate)}).` };
  if (!d.schoolType) return { kind: 'schoolType' };
  if (d.schoolType === 'NOT_SK' && !d.logoUrl) return { kind: 'logo' };
  if (d.schoolType === 'NOT_SK' && !d.logoRemark?.trim()) return { kind: 'field', field: 'logoRemark' };
  if (!s.excel) return { kind: 'excel' };
  if (!s.kertas_kerja.length && !s.kertas_asked) return { kind: 'kertas' };
  return null;
}

// A typed answer to a field question -> the value to keep, or why it can't be used
export function readFieldAnswer(field: string, text: string, today: string, askedDay: (t: string, today: string) => string): { value: string } | { error: string } {
  const t = String(text || '').trim();
  if (!t) return { error: 'Please type it in.' };
  if (field === 'phone') {
    const v = t.replace(/[^0-9-]/g, '');
    return PHONE_RE.test(v) ? { value: v } : { error: 'That isn\'t a phone number — numbers and "-" only, e.g. 012-3456789.' };
  }
  if (field === 'functionDate' || field === 'shipmentDate') {
    if (field === 'shipmentDate' && /^(-|none|tiada|no)$/i.test(t)) return { value: '' };
    const v = askedDay(t, today);
    return v ? { value: v } : { error: 'I can\'t read that date — e.g. 23/11/2026.' };
  }
  return { value: t.toUpperCase() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "23 Nov 2026" — the website's formatDate
export function showDay(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}
// a picked day as the website stores it (malaysiaDayIso)
export const storedDay = (iso: string) => (iso ? `${iso}T00:00:00+08:00` : null);

const esc = (t: unknown) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Item = { jenisPlak: string; qty: string | number; harga: number; categoryKey: string; categoryLabel?: string };

// The order as it will go in, for the salesman to check before Submit
export function summaryHtml(s: Session, items: Item[], total: number, remark: string, crystal: boolean) {
  const d = s.details;
  const byPlak = new Map<string, { qty: number; harga: number }>();
  items.forEach((it) => {
    const key = `${it.categoryLabel || it.categoryKey} — ${it.jenisPlak}`;
    const row = byPlak.get(key) || { qty: 0, harga: 0 };
    row.qty += Number(it.qty) || 0;
    row.harga += Number(it.harga) || 0;
    byPlak.set(key, row);
  });
  const qty = [...byPlak.values()].reduce((n, r) => n + r.qty, 0);
  return [
    '📋 <b>Please check the order</b>',
    `<b>${esc(s.school?.sekolah)}</b>`,
    `Cikgu: ${esc(d.picName)} / ${esc(d.phone)}`,
    `Ketua Panitia: ${esc(d.ketuaPanitia)} · Terms: ${esc(d.terms)}`,
    `Function Date: ${showDay(d.functionDate)}${d.shipmentDate ? ` · Shipment Date: ${showDay(d.shipmentDate)}` : ''}`,
    `Logo: ${d.schoolType === 'NOT_SK' ? `Others — ${esc(d.logoRemark)}` : 'SK'}`,
    '',
    ...[...byPlak.entries()].map(([k, r]) => `• ${esc(k)}: ${r.qty} — ${money(r.harga)}`),
    `<b>Total: ${qty} pcs — ${money(total)}</b>`,
    ...(remark ? ['', `Remark: ${esc(remark)}`] : []),
    '',
    `Files: ${esc(s.excel?.name)}${s.kertas_kerja.length ? ` + kertas kerja: ${s.kertas_kerja.map((f) => esc(f.name)).join(', ')}` : ' (no kertas kerja)'}`,
    ...(crystal ? ['💎 Has crystals — the artwork will be marked <b>not confirmed</b>; confirm it on the website after checking the Crystal Preview.'] : []),
  ].join('\n');
}

// The orders row a New Order submit writes (AppState.jsx submitOrder + ordersApi.js toDbOrder), as the
// salesman: his school's account owns it, he made it. bot_submit_order (0118) adds the ORD number.
export function orderRow(o: {
  s: Session; salesman: { id: string; name: string }; items: Item[]; total: number; remark: string; datePlaced: string;
  excelFile: { path: string; name: string; hash: string }; kertasKerja: { path: string; name: string }[];
  snapshot: Record<string, unknown>; duplicateCheck: unknown;
}) {
  const d = o.s.details;
  return {
    invoice_id: null, invoice_groups: [], date_placed: o.datePlaced, delivery_date: 'TBD',
    total_amount: o.total, status: 'Reviewing Order', price_adjusted: false,
    sekolah: o.s.school!.sekolah, school_language: o.s.school!.schoolLanguage || 'SK',
    sales: o.salesman.name, salesman_id: o.salesman.id,
    pic_name: d.picName, phone: d.phone, ketua_panitia: d.ketuaPanitia, terms: d.terms || null, remark: o.remark || null,
    shipment_date: storedDay(d.shipmentDate), function_date: storedDay(d.functionDate),
    logo_data_url: d.schoolType === 'NOT_SK' ? d.logoUrl || null : null,
    logo_file_name: d.schoolType === 'NOT_SK' ? d.logoName || 'logo.jpg' : null,
    logo_remark: d.schoolType === 'NOT_SK' ? d.logoRemark || null : null,
    school_type: d.schoolType || 'SK',
    import_file_path: o.excelFile.path, import_file_name: o.excelFile.name, import_files: [o.excelFile],
    kertas_kerja_files: o.kertasKerja,
    duplicate_check: o.duplicateCheck ?? null,
    items: o.items.map((it) => ({ ...it, importFile: o.excelFile.path })),
    snapshot: { ...o.snapshot, placedBy: o.salesman.name, viaTelegram: true },
    created_by: o.s.school!.id, created_by_salesman: o.salesman.id,
    artwork_confirmed_at: null, urgent: false,
  };
}
