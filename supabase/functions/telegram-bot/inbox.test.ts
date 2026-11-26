import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.ts', () => ({ db: {} }));
const { planBatch, waitForQuiet } = await import('./inbox.ts');

const chat = { id: 7, type: 'private' };
const from = { id: 42 };
const text = (message_id: number, t: string) => ({ message_id, chat, from, text: t });
const doc = (message_id: number, name: string, extra = {}) => ({ message_id, chat, from, document: { file_id: `f${message_id}`, file_name: name }, ...extra });

describe('planBatch', () => {
  it('reads a text sent beside a kertas kerja as its notes, before or after it', () => {
    const steps = planBatch([text(3, 'semua KOD PKC 263'), doc(1, 'kertas kerja.pdf'), text(2, '帮我填form')], true);
    expect(steps).toHaveLength(1);
    expect(steps[0][0].caption).toBe('帮我填form\nsemua KOD PKC 263');
  });

  it('keeps the file\'s own caption first', () => {
    const [[m]] = planBatch([doc(1, 'kk.docx', { caption: 'TAHUN 6 sahaja' }), text(2, 'tolong isi')], true);
    expect(m.caption).toBe('TAHUN 6 sahaja\ntolong isi');
  });

  it('leaves a list, a cancel and a text with no file as their own messages', () => {
    const list = text(2, 'SEKOLAH NAMA: SK TAMAN MEGAH\nCIKGU NAMA: PN AISYAH');
    const steps = planBatch([doc(1, 'SK TAMAN MEGAH (FORM ANUGERAH).xlsx'), list, text(3, 'cancel')], true);
    expect(steps.map((s) => s.map((m) => m.message_id))).toEqual([[1], [2], [3]]);
    expect(steps[0][0].caption).toBeUndefined();
    expect(planBatch([text(5, 'hello')], true)).toEqual([[text(5, 'hello')]]);
  });

  it('merges nothing while the order chat is asking him something', () => {
    const steps = planBatch([doc(1, 'page 2.jpg'), text(2, 'PKC 263')], false);
    expect(steps.map((s) => s.map((m) => m.message_id))).toEqual([[1], [2]]);
  });

  it('runs an album as one step, in message order', () => {
    const a = (id: number) => doc(id, `p${id}.jpg`, { media_group_id: 'g1' });
    const steps = planBatch([a(5), text(4, 'notes'), a(6), doc(7, 'other.pdf')], true);
    expect(steps.map((s) => s.map((m) => m.message_id))).toEqual([[5, 6], [7]]);
    expect(steps[1][0].caption).toBe('notes');
  });
});

// bot_inbox as an array behind the few supabase-js calls waitForQuiet makes
type Row = Record<string, any>;
function fakeInbox(rows: Row[] = []) {
  const query = (act: 'select' | 'update' | 'delete', payload: Row = {}) => {
    const conds: ((r: Row) => boolean)[] = [];
    const hits = () => rows.filter((r) => conds.every((c) => c(r)));
    const apply = () => {
      const hit = hits();
      if (act === 'update') hit.forEach((r) => Object.assign(r, payload));
      if (act === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const q: Row = {
      eq: (k: string, v: unknown) => { conds.push((r) => r[k] === v); return q; },
      gt: (k: string, v: number) => { conds.push((r) => r[k] > v); return q; },
      lt: (k: string, v: number | string) => { if (k === 'message_id') conds.push((r) => r[k] < (v as number)); else conds.push(() => false); return q; },
      lte: (k: string, v: number) => { conds.push((r) => r[k] <= v); return q; },
      gte: () => q,
      limit: (n: number) => Promise.resolve({ data: hits().slice(0, n), error: null }),
      select: () => Promise.resolve(apply()),
      then: (res: (v: unknown) => void) => res(apply()),
    };
    return q;
  };
  return {
    rows,
    from: () => ({
      upsert: async (row: Row) => { rows.push({ ...row, taken: false, status_message_id: null }); return { error: null }; },
      select: () => query('select'),
      update: (payload: Row) => query('update', payload),
      delete: () => query('delete'),
    }),
  };
}

describe('waitForQuiet', () => {
  it('the last message takes every waiting one; an earlier one leaves them to it', async () => {
    const client = fakeInbox();
    let release: () => void = () => {};
    const firstRun = waitForQuiet(text(1, 'kertas kerja coming'), { client, wait: () => new Promise<void>((r) => { release = r; }) } as never);
    await new Promise((r) => setTimeout(r, 0));
    const secondRun = waitForQuiet(doc(2, 'kk.pdf'), { client, wait: async () => {} } as never);
    // the second message's own wait ended first here, so it already took both
    expect((await secondRun)?.msgs.map((m) => m.message_id)).toEqual([1, 2]);
    release();
    expect(await firstRun).toBeNull();
  });

  it('says "Reading" once per batch and hands the note back to take off', async () => {
    const client = fakeInbox();
    const announce = vi.fn(async () => 500);
    let release: () => void = () => {};
    const firstRun = waitForQuiet(text(1, 'a'), { client, announce, wait: () => new Promise<void>((r) => { release = r; }) } as never);
    await new Promise((r) => setTimeout(r, 0));
    const got = await waitForQuiet(doc(2, 'kk.pdf'), { client, announce, wait: async () => {} } as never);
    release();
    await firstRun;
    expect(announce).toHaveBeenCalledTimes(1);
    expect(got?.statusIds).toEqual([500]);
  });

  it('a message with nothing after it is read alone', async () => {
    const client = fakeInbox();
    expect((await waitForQuiet(text(9, 'hi'), { client, wait: async () => {} } as never))?.msgs).toEqual([text(9, 'hi')]);
  });
});
