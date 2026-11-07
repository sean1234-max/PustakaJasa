// ReviewAgent's own review of an order (order_auto_reviews, telegram-bot autoReview.ts) on the review
// list (Sean, 2026-11-07): 🟢 nothing found · ⚠N N things asked · 💬 the salesman answered · 🔎 reviewing ·
// ⚪ couldn't compare (no teacher's file) · blank: not reviewed yet.
export type AutoReview = { status: string; issue_count: number; answered_at: string | null } | undefined;

export function reviewMark(r: AutoReview) {
  if (!r) return '';
  if (r.status === 'running') return ' 🔎';
  if (r.status === 'failed') return '';
  if (r.issue_count > 0) return r.answered_at ? ' 💬' : ` ⚠${r.issue_count}`;
  return r.status === 'skipped' ? ' ⚪' : ' 🟢';
}

export const REVIEW_MARKS_LEGEND = '🟢 ReviewAgent found nothing · ⚠ = questions asked · 💬 = the salesman answered';
