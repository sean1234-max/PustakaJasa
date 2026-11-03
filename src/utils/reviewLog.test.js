import { describe, it, expect } from 'vitest';
import { reviewChanges, aiOutcomes } from './reviewLog';

// TOKOH-style item: one plaque per description row
const item = (rows) => ({
  id: 'i1', categoryKey: 'UMUM', categoryLabel: 'ORDER LAIN-LAIN', blockIdx: 0, jenisPlak: 'PKF 265',
  detail: { lines: { 'UMUM::0::0': 'MAJLIS ANUGERAH 2026' }, rows },
});

describe('reviewChanges', () => {
  it('is empty when nothing changed', () => {
    const items = [item([{ id: 'r1', qty: 2, l1: 'JOHAN' }])];
    expect(reviewChanges(items, items)).toEqual([]);
  });

  it('lists the plaques that went away and came in, per sheet', () => {
    const before = [item([{ id: 'r1', qty: 2, l1: 'ANUGERAH KEMERLANGAN' }])];
    const after = [item([{ id: 'r1', qty: 2, l1: 'ANUGERAH KECEMERLANGAN' }])];
    const [sheet] = reviewChanges(before, after);
    expect(sheet.sheet).toBe('ORDER LAIN-LAIN');
    expect(sheet.removed).toEqual([{ text: expect.stringContaining('KEMERLANGAN'), count: 2 }]);
    expect(sheet.added).toEqual([{ text: expect.stringContaining('KECEMERLANGAN'), count: 2 }]);
  });
});

describe('aiOutcomes', () => {
  const done = [item([{ id: 'r1', qty: 1, l1: 'JOHAN' }])];

  it('marks a flag whose words are gone as changed, still there as kept', () => {
    const out = aiOutcomes([{ rule: 'F2', find: 'KEMERLANGAN' }, { rule: 'R1', find: 'JOHAN' }, { rule: 'I4' }], done);
    expect(out.map((o) => o.outcome)).toEqual(['changed', 'kept', 'unknown']);
  });
});
