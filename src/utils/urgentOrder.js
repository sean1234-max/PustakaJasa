import { parseDisplayDate, toMalaysiaDay } from '../data/catalog';

// "Urgent" = the Shipment Date falls within 7 calendar days of the day the
// salesman APPROVES the order, that day counting as day 1 (Sean,
// 2026-10-09): approved on the 7th → shipping on the 13th or earlier is
// urgent, the 14th is not. Weekends and public holidays count like any
// other day. Snapshotted at approval (Sales approves / Store Admin approves
// with the invoice — src/state/AppState.jsx); Production can change it by
// hand afterwards.
export const URGENT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// A calendar day from a picked Date, a "05 Oct 2026" display date, or a
// stored ISO Shipment Date (its Malaysian day).
function calendarDay(v) {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getFullYear(), v.getMonth(), v.getDate());
  return parseDisplayDate(v) || toMalaysiaDay(v);
}

export function isUrgentShipment(approvedOn, shipmentDate) {
  const approved = calendarDay(approvedOn);
  const ship = calendarDay(shipmentDate);
  if (!approved || !ship) return false;
  return Math.round((ship - approved) / DAY_MS) < URGENT_WINDOW_DAYS;
}

export function prioritizeUrgentOrders(orders) {
  return [...orders].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
}

// A Tambahan's cards sit right after its parent order's cards when both are in the list (Sean,
// 2026-10-22: ORD-0088, a Tambahan of ORD-0069, beside 0069's ACARA and CRYSTAL cards); otherwise
// it keeps its own place.
export function keepTambahanWithParent(cards) {
  const ids = new Set(cards.map((c) => c.id));
  const children = new Map();
  cards.forEach((c) => {
    if (!c.parentOrderId || !ids.has(c.parentOrderId)) return;
    children.set(c.parentOrderId, [...(children.get(c.parentOrderId) || []), c]);
  });
  const out = [];
  cards.forEach((c, i) => {
    if (c.parentOrderId && ids.has(c.parentOrderId)) return;
    out.push(c);
    const lastOfParent = !cards.slice(i + 1).some((n) => n.id === c.id);
    if (lastOfParent) out.push(...(children.get(c.id) || []));
  });
  return out;
}

// An urgent order gives up 2.5% of its whole order total (add-ons
// included) as commission (Sean, 2026-10-06). The Edge Function
// sync-urgent-order-sheet writes the same figure to the Google Sheet.
export const URGENT_COMMISSION_RATE = 0.025;

// The "Urgent Orders" Google Sheet that sync-urgent-order-sheet writes to
// (GOOGLE_SHEETS_SPREADSHEET_ID) — only for the Urgent List buttons (Store
// Admin, Admin); the Edge Function still knows it via its own Supabase secret.
// Who can open it is decided by the Sheet's sharing (Admin + Store Admin).
export const URGENT_ORDERS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1gccvpiiY4QfzkXudF36RCx5350sCY5lVsGPRqW7lvrA/edit?gid=0#gid=0';

export function urgentCommission(amount) {
  return Math.round((Number(amount) || 0) * URGENT_COMMISSION_RATE * 100) / 100;
}

// datePlaced is a display string ("06 Oct 2026") → "Oct 2026".
function monthOf(datePlaced) {
  const m = /^\d{1,2}\s+([A-Za-z]{3})[a-z]*\s+(\d{4})$/.exec(String(datePlaced || '').trim());
  return m ? `${m[1]} ${m[2]}` : 'Unknown';
}

// Admin's Urgent Commission page: every urgent, not-cancelled order with its
// commission, plus per month → per salesman totals (newest month first,
// following the order list's own newest-first order).
export function summarizeUrgentCommission(orders) {
  const rows = orders
    .filter((o) => o.urgent && o.status !== 'Cancelled')
    .map((o) => ({ order: o, month: monthOf(o.datePlaced), amount: Number(o.totalAmount) || 0, commission: urgentCommission(o.totalAmount) }));
  const months = [];
  rows.forEach((r) => {
    let month = months.find((m) => m.month === r.month);
    if (!month) { month = { month: r.month, salesmen: [], commission: 0 }; months.push(month); }
    const name = r.order.sales || 'No salesman';
    let sm = month.salesmen.find((s) => s.name === name);
    if (!sm) { sm = { name, count: 0, amount: 0, commission: 0 }; month.salesmen.push(sm); }
    sm.count += 1;
    sm.amount += r.amount;
    sm.commission = Math.round((sm.commission + r.commission) * 100) / 100;
    month.commission = Math.round((month.commission + r.commission) * 100) / 100;
  });
  return { rows, months };
}

// Production can fix an order's Shipment Date and Urgent flag (Sean,
// 2026-10-09) until the order is Completed.
export const SHIPMENT_EDITABLE_STATUSES = ['Reviewing Order', 'Salesman Approved', 'In Production'];

// What that change means for the urgent Google Sheet: 'remove' its row (no
// longer urgent), 'sync' it (still / newly urgent and either already in the
// Sheet or already invoiced — an un-invoiced order joins at invoice time as
// usual), or null.
export function urgentSheetAction({ urgent, wasSynced, hasInvoice }) {
  if (!urgent) return wasSynced ? 'remove' : null;
  return wasSynced || hasInvoice ? 'sync' : null;
}
