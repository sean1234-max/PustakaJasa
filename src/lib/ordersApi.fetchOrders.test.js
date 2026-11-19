import { describe, it, expect, vi, beforeEach } from 'vitest';

// A fake orders table behind a chainable supabase query; `cap` is the server's max rows a request.
let table = [];
let cap = 1000;
const calls = [];
function builder() {
  const q = { filters: [], range: null };
  const chain = {
    select: (_cols, opts) => { q.count = opts?.count; return chain; },
    order: () => chain,
    eq: (col, val) => { q.filters.push([col, val]); return chain; },
    range: (from, to) => { q.range = [from, to]; return chain; },
    then: (resolve) => {
      calls.push(q);
      const rows = table.filter((r) => q.filters.every(([c, v]) => r[c] === v));
      const [from, to] = q.range;
      const data = rows.slice(from, Math.min(to + 1, from + cap));
      return resolve({ data, error: null, count: q.count === 'exact' ? rows.length : null });
    },
  };
  return chain;
}
vi.mock('./supabaseClient', () => ({ supabase: { from: () => builder() } }));

const { fetchOrders } = await import('./ordersApi');

const makeRows = (n) => Array.from({ length: n }, (_, i) => ({ id: `ORD-${String(n - i).padStart(5, '0')}`, created_by: i % 2 ? 't1' : 't2' }));

describe('fetchOrders', () => {
  beforeEach(() => { calls.length = 0; cap = 1000; });

  it('loads every order however many there are, not just the newest 500', async () => {
    table = makeRows(2503);
    const orders = await fetchOrders('u', 'production');
    expect(orders).toHaveLength(2503);
    expect(new Set(orders.map((o) => o.id)).size).toBe(2503);
    expect(orders.map((o) => o.id).at(-1)).toBe('ORD-00001');
  });

  it('keeps paging when the server gives fewer rows a request than asked', async () => {
    table = makeRows(1200);
    cap = 300;
    const orders = await fetchOrders('u', 'admin');
    expect(orders).toHaveLength(1200);
    expect(calls).toHaveLength(4);
  });

  it('makes one request when everything fits in a page', async () => {
    table = makeRows(562);
    expect(await fetchOrders('u', 'production')).toHaveLength(562);
    expect(calls).toHaveLength(1);
  });

  it('keeps created_at as createdAt — the Tambahan print orders earlier Tambahans by it', async () => {
    table = [{ id: 'ORD-0336', created_at: '2026-11-07T04:57:49.51884+00:00', parent_order_id: 'ORD-0269' }];
    const [order] = await fetchOrders('u', 'production');
    expect(order.createdAt).toBe('2026-11-07T04:57:49.51884+00:00');
  });

  it("a teacher still gets only their own orders, all of them", async () => {
    table = makeRows(2001);
    const orders = await fetchOrders('t1', 'teacher');
    expect(orders).toHaveLength(1000);
    expect(calls.every((q) => q.filters.some(([c, v]) => c === 'created_by' && v === 't1'))).toBe(true);
  });
});
