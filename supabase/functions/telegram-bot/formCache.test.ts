import { describe, it, expect, vi } from 'vitest';
import { formKey, isEmptyReading, readFormCached } from './formCache.ts';

// form_reads as a Map behind the few supabase-js calls readFormCached makes
function fakeDb() {
  const rows = new Map<string, unknown>();
  return {
    rows,
    from: () => ({
      select: () => ({ eq: (_: string, key: string) => ({ maybeSingle: async () => ({ data: rows.has(key) ? { result: rows.get(key) } : null, error: null }) }) }),
      upsert: async (row: { key: string; result: unknown }) => { rows.set(row.key, row.result); return { error: null }; },
    }),
  };
}

const pdf = { type: 'text' as const, text: 'SK SERI KUNDANG — PRESTASI TERBAIK AKADEMIK 1 UIA' };

describe('readFormCached', () => {
  it('reads a file once and reuses the reading for the same file', async () => {
    const db = fakeDb();
    const reading = { school: 'SK SERI KUNDANG', plaques: [{ award: 'PRESTASI TERBAIK AKADEMIK' }] };
    const read = vi.fn(async () => ({ input: reading }));
    const first = await readFormCached(db as never, read, pdf, 'HADIAH HAC 1.pdf', '');
    const again = await readFormCached(db as never, read, pdf, 'HADIAH HAC 1 (copy).pdf', '');
    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ input: reading, cached: false });
    expect(again).toEqual({ input: reading, cached: true });
  });

  it('reads again when the content or the notes differ', async () => {
    const db = fakeDb();
    const read = vi.fn(async () => ({ input: {} }));
    await readFormCached(db as never, read, pdf, 'a.pdf', '');
    await readFormCached(db as never, read, { ...pdf, text: `${pdf.text} UPM` }, 'a.pdf', '');
    await readFormCached(db as never, read, pdf, 'a.pdf', 'semua PKC 263');
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("doesn't save a failed reading", async () => {
    const db = fakeDb();
    expect(await readFormCached(db as never, async () => null, pdf, 'a.pdf', '')).toBeNull();
    expect(db.rows.size).toBe(0);
  });

  it("doesn't save a reading with no plaques and no sashes (Sonnet gave up on SK JUGRA, 2026-11-06)", async () => {
    const db = fakeDb();
    const gaveUp = { input: { school: 'SK JUGRA', plaques: [], selempang: [], questions: ['please re-run'] } };
    expect(await readFormCached(db as never, async () => gaveUp, pdf, 'a.pdf', '')).toEqual({ ...gaveUp, cached: false });
    expect(db.rows.size).toBe(0);
  });

  it('knows an empty reading', () => {
    expect(isEmptyReading(null)).toBe(true);
    expect(isEmptyReading({ input: { plaques: [], selempang: [] } })).toBe(true);
    expect(isEmptyReading({ input: { plaques: [{}], selempang: [] } })).toBe(false);
    expect(isEmptyReading({ input: { plaques: [], selempang: [{}] } })).toBe(false);
  });

  it('keys ignore the file name but not the notes', async () => {
    expect(await formKey(pdf, ' x ')).toBe(await formKey(pdf, 'x'));
    expect(await formKey(pdf, 'x')).not.toBe(await formKey(pdf, 'y'));
  });
});
