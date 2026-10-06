// "Urgent" = fewer than 5 Mon-Fri working days between "today" (the
// moment Shipment Date is first saved, at approval time) and the
// Shipment Date itself. Weekends are skipped; public holidays are NOT
// excluded — purely date-driven, no manual override. Snapshotted once
// at approval (see approveOrder / approveAndSetInvoiceId in
// src/state/AppState.jsx) and never recomputed afterward.
//
// Boundary semantics: counts weekdays strictly AFTER fromDate up to and
// INCLUDING toDate — i.e. the half-open interval (fromDate, toDate].
// fromDate itself is never counted. Worked example: approved on a
// Monday, Shipment Date the FOLLOWING Monday -> Tue,Wed,Thu,Fri,Mon = 5
// working days = NOT urgent (5 is not < 5); any earlier date is urgent.
function dayOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function countWorkingDaysBetween(fromDate, toDate) {
  const from = dayOnly(fromDate);
  const to = dayOnly(toDate);
  if (to <= from) return 0;
  let count = 0;
  const cur = new Date(from);
  cur.setDate(cur.getDate() + 1);
  while (cur <= to) {
    const dow = cur.getDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export function isUrgentShipment(fromDate, shipmentDate) {
  if (!fromDate || !shipmentDate) return false;
  return countWorkingDaysBetween(fromDate, shipmentDate) < 5;
}

export function prioritizeUrgentOrders(orders) {
  return [...orders].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent));
}

// An urgent order gives up 2.5% of its whole order total (add-ons
// included) as commission (Sean, 2026-10-06). The Edge Function
// sync-urgent-order-sheet writes the same figure to the Google Sheet.
export const URGENT_COMMISSION_RATE = 0.025;

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
