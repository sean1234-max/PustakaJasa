import { describe, it, expect, vi } from 'vitest';
import { formKey, readFormCached } from './formCache.ts';

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
    const read = vi.fn(async () => ({ input: { school: 'SK SERI KUNDANG' } }));
    const first = await readFormCached(db as never, read, pdf, 'HADIAH HAC 1.pdf', '');
    const again = await readFormCached(db as never, read, pdf, 'HADIAH HAC 1 (copy).pdf', '');
    expect(read).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ input: { school: 'SK SERI KUNDANG' }, cached: false });
    expect(again).toEqual({ input: { school: 'SK SERI KUNDANG' }, cached: true });
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

  it('keys ignore the file name but not the notes', async () => {
    expect(await formKey(pdf, ' x ')).toBe(await formKey(pdf, 'x'));
    expect(await formKey(pdf, 'x')).not.toBe(await formKey(pdf, 'y'));
  });
});
