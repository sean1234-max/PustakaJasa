// Which salesmen to remind to approve (Sean, 2026-11-09: "一旦 done review 后 telegram auto 去对的 group
// remind 他们"): once, at Done Review — no second reminder (Sean, 2026-11-09). Keyed on the review's time, so
// an order reviewed again (after an edit) is reminded again. No Telegram or database here.

const FIRST_REMINDER_WITHIN_DAYS = 7;   // orders already waiting long before this went live: no catch-up flood
const MS_PER_DAY = 86_400_000;
const TEST_ORDER = /^ORD-(TEST-|90\d\d$)/;

export type WaitingOrder = { id: string; status: string; reviewed_at: string | null; cancelled_at?: string | null };
export const reminderKey = (o: WaitingOrder) => `approve:1:${o.id}:${o.reviewed_at}`;

export function dueReminders(orders: WaitingOrder[], sent: Set<string>, now = Date.now()) {
  const due: { id: string; key: string }[] = [];
  for (const o of orders) {
    if (o.status !== 'Reviewing Order' || !o.reviewed_at || o.cancelled_at || TEST_ORDER.test(o.id)) continue;
    const key = reminderKey(o);
    if (!sent.has(key) && (now - Date.parse(o.reviewed_at)) / MS_PER_DAY <= FIRST_REMINDER_WITHIN_DAYS) due.push({ id: o.id, key });
  }
  return due;
}
