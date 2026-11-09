// Which salesmen to remind to approve, and when (Sean, 2026-11-09: "一旦 done review 后 telegram auto 去对的
// group remind 他们"): once at Done Review, once more if it still isn't approved 2 days later. Keyed on the
// review's time, so an order reviewed again (after an edit) is reminded again. No Telegram or database here.

export const SECOND_REMINDER_DAYS = 2;
const FIRST_REMINDER_WITHIN_DAYS = 7;   // orders already waiting long before this went live: no catch-up flood
const MS_PER_DAY = 86_400_000;
const TEST_ORDER = /^ORD-(TEST-|90\d\d$)/;

export type WaitingOrder = { id: string; status: string; reviewed_at: string | null; cancelled_at?: string | null };
export const reminderKey = (o: WaitingOrder, round: 1 | 2) => `approve:${round}:${o.id}:${o.reviewed_at}`;

export function dueReminders(orders: WaitingOrder[], sent: Set<string>, now = Date.now()) {
  const due: { id: string; round: 1 | 2; key: string }[] = [];
  for (const o of orders) {
    if (o.status !== 'Reviewing Order' || !o.reviewed_at || o.cancelled_at || TEST_ORDER.test(o.id)) continue;
    const waited = (now - Date.parse(o.reviewed_at)) / MS_PER_DAY;
    const first = reminderKey(o, 1);
    if (!sent.has(first)) {
      if (waited <= FIRST_REMINDER_WITHIN_DAYS) due.push({ id: o.id, round: 1, key: first });
      continue;
    }
    const second = reminderKey(o, 2);
    if (!sent.has(second) && waited >= SECOND_REMINDER_DAYS) due.push({ id: o.id, round: 2, key: second });
  }
  return due;
}
