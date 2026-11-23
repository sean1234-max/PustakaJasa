import { describe, it, expect } from 'vitest';
import { findTypedRow, googleFetch } from '../../supabase/functions/fill-google-form/masterList.ts';

// a Sheets date serial for a day (days from 1899-12-30)
const serial = (iso) => (Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const row = (school, qty, typed = '', day = '2026-11-16') => [serial(day), '', '', '', 'MAGGIE', school, 'SALES', qty, typed];

describe('findTypedRow (Done Typing → MASTER LIST column I)', () => {
  it('finds the website row of the school with that QTY', () => {
    const rows = [row('SK LAIN', 192), row('SK KANCHONG DARAT (W) - kurikulum', 192)];
    expect(findTypedRow(rows, 'SK KANCHONG DARAT', 192, NOW)).toEqual({ row: 3, school: 'SK KANCHONG DARAT (W) - kurikulum', qty: 192 });
  });

  it('skips a row already typed, so a split invoice with the same QTY takes the next one', () => {
    const rows = [row('SK KANCHONG DARAT', 50, 'IKIN (NOV)'), row('SK KANCHONG DARAT', 50)];
    expect(findTypedRow(rows, 'SEKOLAH KEBANGSAAN KANCHONG DARAT', 50, NOW).row).toBe(3);
  });

  it('takes the earliest of two untyped rows', () => {
    const rows = [row('SK KANCHONG DARAT', 50), row('SK KANCHONG DARAT', 50)];
    expect(findTypedRow(rows, 'SK KANCHONG DARAT', 50, NOW).row).toBe(2);
  });

  it('finds nothing for another QTY, another school or a row older than 120 days', () => {
    expect(findTypedRow([row('SK KANCHONG DARAT', 51)], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
    expect(findTypedRow([row('SK BUKIT RAYA', 50)], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
    expect(findTypedRow([row('SK KANCHONG DARAT', 50, '', '2026-06-01')], 'SK KANCHONG DARAT', 50, NOW)).toBeNull();
  });
});

// Google not answering (Sean, 2026-11-23): each call is tried up to 3 times on a 429 / 5xx or a dead line
describe('googleFetch', () => {
  const fake = (answers) => {
    const calls = [];
    return {
      calls,
      deps: {
        fetch: async (url, init) => { calls.push(init); const a = answers[calls.length - 1]; if (a instanceof Error) throw a; return new Response('x', { status: a }); },
        sleep: async () => {},
      },
    };
  };

  it('tries again after a 503 and returns the answer that worked', async () => {
    const f = fake([503, 200]);
    const res = await googleFetch('u', {}, true, f.deps);
    expect(res.status).toBe(200);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].signal).toBeDefined();
  });

  it('gives up after 3 tries and returns the last refusal', async () => {
    const f = fake([503, 500, 503, 200]);
    expect((await googleFetch('u', {}, true, f.deps)).status).toBe(503);
    expect(f.calls).toHaveLength(3);
  });

  it('never repeats a Form post that got no answer (it may have gone in), but repeats a refused one', async () => {
    const dead = fake([new Error('timed out'), 200]);
    await expect(googleFetch('u', {}, false, dead.deps)).rejects.toThrow('timed out');
    expect(dead.calls).toHaveLength(1);
    const refused = fake([503, 200]);
    expect((await googleFetch('u', {}, false, refused.deps)).status).toBe(200);
  });

  it('does not repeat a 4xx (a real refusal)', async () => {
    const f = fake([403, 200]);
    expect((await googleFetch('u', {}, true, f.deps)).status).toBe(403);
    expect(f.calls).toHaveLength(1);
  });
});
