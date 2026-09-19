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
