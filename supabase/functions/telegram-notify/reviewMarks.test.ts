import { describe, it, expect } from 'vitest';
import { reviewMark } from './reviewMarks.ts';

describe('reviewMark', () => {
  it('shows what ReviewAgent found', () => {
    expect(reviewMark(undefined)).toBe('');
    expect(reviewMark({ status: 'running', issue_count: 0, answered_at: null })).toBe(' 🔎');
    expect(reviewMark({ status: 'done', issue_count: 0, answered_at: null })).toBe(' 🟢');
    expect(reviewMark({ status: 'done', issue_count: 3, answered_at: null })).toBe(' ⚠3');
    expect(reviewMark({ status: 'done', issue_count: 3, answered_at: '2026-11-07T10:00:00Z' })).toBe(' 💬');
    expect(reviewMark({ status: 'skipped', issue_count: 0, answered_at: null })).toBe(' ⚪');
    expect(reviewMark({ status: 'failed', issue_count: 0, answered_at: null })).toBe('');
  });
});
