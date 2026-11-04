// A Telegram change request (supabase/functions/telegram-bot, bot_requests) as what the order page
// does on Apply: the Shipment Date through Production's own Shipment editor path (Urgent kept as it
// is — it never changes by itself when the date does), Function Date and Remark as order details.

// "2026-11-19" → that calendar day (local midnight), the shape the date pickers give
export const dayOf = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

export function applyPlan(changes) {
  const plan = { shipmentDate: null, details: {} };
  (changes || []).forEach((c) => {
    if (c.field === 'shipmentDate') plan.shipmentDate = dayOf(c.to);
    if (c.field === 'functionDate') plan.details.functionDate = dayOf(c.to);
    if (c.field === 'remark') plan.details.remark = c.to;
  });
  return plan;
}
