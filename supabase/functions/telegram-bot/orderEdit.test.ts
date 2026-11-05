import { describe, it, expect } from 'vitest';
import { applyEdit, prepareEdit } from './orderEdit.ts';

// A tiny stand-in for the Supabase client: two tables, the calls orderEdit makes
function fakeDb(order: Record<string, unknown>) {
  const tables: Record<string, Record<string, unknown>[]> = { orders: [{ ...order }], bot_requests: [] };
  const from = (name: string) => {
    let rows = tables[name];
    let patch: Record<string, unknown> | null = null;
    const q: any = {
      select: () => q,
      eq: (k: string, v: unknown) => {
        rows = rows.filter((r) => r[k] === v);
        if (patch) { rows.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }); }
        return q;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0], error: null }),
      insert: (row: Record<string, unknown>) => {
        const saved = { id: `r${tables[name].length + 1}`, status: 'pending', created_at: new Date(Date.now() - 60_000).toISOString(), ...row };
        tables[name].push(saved);
        rows = [saved];
        return q;
      },
      update: (p: Record<string, unknown>) => { patch = p; return q; },
    };
    return q;
  };
  return { db: { from } as any, tables };
}

const ORDER = { id: 'ORD-0234', sekolah: 'SK X', status: 'In Production', shipment_date: '2026-11-20T00:00:00+08:00', function_date: null, remark: 'OLD', urgent: false, cancelled_at: null };
const ask = (over = {}) => ({ order_id: 'ord-0234', shipment_date: null, function_date: null, remark_mode: 'replace' as const, remark_text: 'BST qty x 10', ...over });

describe('orderEdit', () => {
  it('prepares a Remark replacement without touching the order', async () => {
    const { db, tables } = fakeDb(ORDER);
    const res: any = await prepareEdit(db, ask(), 'Sean');
    expect(res.changes).toEqual([{ field: 'remark', from: 'OLD', to: 'BST qty x 10' }]);
    expect(tables.orders[0].remark).toBe('OLD');
  });

  it('appends when asked to add', async () => {
    const { db } = fakeDb(ORDER);
    const res: any = await prepareEdit(db, ask({ remark_mode: 'append' }), 'Sean');
    expect(res.changes[0].to).toBe('OLD\nBST qty x 10');
  });

  it('writes it only for a yes sent after the change was shown', async () => {
    const { db, tables } = fakeDb(ORDER);
    const { request_id }: any = await prepareEdit(db, ask(), 'Sean');
    const tooEarly: any = await applyEdit(db, request_id, new Date(Date.now() - 120_000), 'Sean');
    expect(tooEarly.error).toMatch(/not confirmed/);
    expect(tables.orders[0].remark).toBe('OLD');
    await applyEdit(db, request_id, new Date(), 'Sean');
    expect(tables.orders[0].remark).toBe('BST qty x 10');
    expect(tables.bot_requests[0].status).toBe('applied');
  });

  it('leaves an urgent order\'s Shipment Date to the order page', async () => {
    const { db, tables } = fakeDb({ ...ORDER, urgent: true });
    const { request_id }: any = await prepareEdit(db, ask({ shipment_date: '2026-11-25', remark_mode: null, remark_text: null }), 'Sean');
    const res: any = await applyEdit(db, request_id, new Date(), 'Sean');
    expect(res.leftToWebsite).toBeTruthy();
    expect(tables.orders[0].shipment_date).toBe('2026-11-20T00:00:00+08:00');
    expect(tables.bot_requests[0].status).toBe('pending');
  });

  it('refuses a Completed order', async () => {
    const { db } = fakeDb({ ...ORDER, status: 'Completed' });
    const res: any = await prepareEdit(db, ask(), 'Sean');
    expect(res.error).toMatch(/Completed/);
  });
});
