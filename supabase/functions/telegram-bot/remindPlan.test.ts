import { describe, it, expect } from 'vitest';
import { dueReminders, reminderKey } from './remindPlan.ts';

const NOW = Date.parse('2026-11-09T10:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const o = (id: string, reviewedDaysAgo: number | null, over = {}) => ({ id, status: 'Reviewing Order', reviewed_at: reviewedDaysAgo == null ? null : ago(reviewedDaysAgo), ...over });

describe('dueReminders', () => {
  it('reminds right after Done Review, once', () => {
    const a = o('ORD-0327', 0.01);
    expect(dueReminders([a], new Set(), NOW)).toEqual([{ id: 'ORD-0327', round: 1, key: reminderKey(a, 1) }]);
    expect(dueReminders([a], new Set([reminderKey(a, 1)]), NOW)).toEqual([]);
  });
  it('a second time after 2 days, then never again', () => {
    const a = o('ORD-0327', 2.1);
    expect(dueReminders([a], new Set([reminderKey(a, 1)]), NOW)).toEqual([{ id: 'ORD-0327', round: 2, key: reminderKey(a, 2) }]);
    expect(dueReminders([a], new Set([reminderKey(a, 1), reminderKey(a, 2)]), NOW)).toEqual([]);
  });
  it('not reviewed, approved, cancelled, test orders, or long-waiting ones from before: nothing', () => {
    expect(dueReminders([
      o('ORD-0001', null), o('ORD-0002', 0.1, { status: 'Salesman Approved' }), o('ORD-0003', 0.1, { cancelled_at: ago(0) }),
      o('ORD-9001', 0.1), o('ORD-TEST-0001', 0.1), o('ORD-0004', 30),
    ], new Set(), NOW)).toEqual([]);
  });
  it('reviewed again after an edit: reminded again', () => {
    const before = o('ORD-0327', 3);
    const again = o('ORD-0327', 0.01);
    expect(dueReminders([again], new Set([reminderKey(before, 1), reminderKey(before, 2)]), NOW)).toHaveLength(1);
  });
});
