import { parseDisplayDate, toMalaysiaDay, invoiceDate, invoiceSource } from '../data/catalog';

// "Urgent" = the Shipment Date falls within 7 calendar days of the day the
// INVOICE is made (开单), that day counting as day 1 (Sean, 2026-10-23 —
// it was the approval day): invoiced on the 23rd → shipping on the 29th or
// earlier is urgent, the 30th is not. Weekends and public holidays count
// like any other day. The salesman's Approve only guesses it (no invoice
// yet); it's set for good when the Invoice Number is saved
// (src/state/AppState.jsx); Production can change it by hand afterwards.
export const URGENT_WINDOW_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MY_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Kuala_Lumpur, UTC+8, no DST

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

// Cards by when their invoice was made, the earliest first (Sean, 2026-10-23: first invoiced, first
// made); cards with no invoice date after them by Shipment Date, the soonest (or already past)
// first, none last — then urgent ones on top (prioritizeUrgentOrders). `invoiceAt(card)` → ms or null.
export function byInvoiceDate(orders, invoiceAt) {
  const ship = (o) => {
    const t = o.shipmentDate ? new Date(o.shipmentDate).getTime() : NaN;
    return Number.isFinite(t) ? t : Infinity;
  };
  // the invoice's Malaysian day only (Sean, 2026-10-23): the same day → Shipment Date soonest
  const day = (o) => { const t = invoiceAt(o); return t == null ? null : Math.floor((t + MY_OFFSET_MS) / DAY_MS); };
  return [...orders].sort((a, b) => {
    const ia = day(a);
    const ib = day(b);
    if (ia != null && ib != null && ia !== ib) return ia - ib;
    if ((ia != null) !== (ib != null)) return ia != null ? -1 : 1;
    return ship(a) - ship(b);
  });
}

// A Tambahan's cards sit right before its parent order's cards when both are in the list (Sean,
// 2026-10-22: ORD-0088 TAMBAHAN, then ORD-0069's ACARA and CRYSTAL cards); otherwise it keeps its
// own place.
export function keepTambahanWithParent(cards) {
  const ids = new Set(cards.map((c) => c.id));
  const isChild = (c) => c.parentOrderId && ids.has(c.parentOrderId);
  const out = [];
  cards.forEach((c, i) => {
    if (isChild(c)) return;
    const firstOfParent = !cards.slice(0, i).some((p) => p.id === c.id);
    if (firstOfParent) out.push(...cards.filter((k) => isChild(k) && k.parentOrderId === c.id));
    out.push(c);
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

// Every dashboard's cards (Sean, 2026-10-23): urgent first, then invoice date earliest first,
// then no invoice yet by Shipment Date soonest. `allOrders`: a Tambahan reads its parent's invoice.
export function nearestFirst(orders, allOrders) {
  return prioritizeUrgentOrders(byInvoiceDate(orders, (o) => invoiceDate(invoiceSource(o, allOrders))?.getTime() ?? null));
}
