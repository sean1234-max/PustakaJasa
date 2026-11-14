import { describe, it, expect } from 'vitest';
import { searchLeaves } from './plakSearch';

const CATALOG = [
  { code: 'YK - 6281' },
  { code: 'YK - 628' },
  { code: 'PKC 263' },
  { code: 'SM-13187', children: [
    { code: 'GOLD', children: [{ code: 'BASE A' }, { code: 'BASE B' }] },
    { code: 'SILVER', children: [{ code: 'BASE B' }] },
  ] },
];
const paths = (q) => searchLeaves(CATALOG, q).map((r) => r.path.join(' / '));

describe('searchLeaves', () => {
  it('finds a code from the middle, ignoring spaces and dashes', () => {
    expect(paths('628')).toEqual(['YK - 628', 'YK - 6281']);
    expect(paths('yk628')[0]).toBe('YK - 628');
    expect(paths('YK-628')[0]).toBe('YK - 628');
  });

  it('puts the exact code first', () => {
    expect(paths('YK - 628')[0]).toBe('YK - 628');
    expect(paths('pkc263')).toEqual(['PKC 263']);
  });

  it('narrows a nested code with several words', () => {
    expect(paths('13187 gold b')[0]).toBe('SM-13187 / GOLD / BASE B');
    expect(paths('13187 base b').slice(0, 2)).toEqual(['SM-13187 / GOLD / BASE B', 'SM-13187 / SILVER / BASE B']);
  });

  it('returns nothing for a blank query or no match', () => {
    expect(paths('  ')).toEqual([]);
    expect(paths('zzz')).toEqual([]);
  });
});
