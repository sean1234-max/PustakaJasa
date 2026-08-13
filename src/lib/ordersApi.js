import { supabase } from './supabaseClient';

// Maps between the camelCase order shape used throughout the app
// (src/state/AppState.jsx, src/data/seedOrders.js) and the snake_case
// columns of the `orders` table (supabase/migrations/0001_orders.sql).

function toDbOrder(order) {
  return {
    id: order.id,
    invoice_id: order.invoiceId ?? null,
    date_placed: order.datePlaced ?? null,
    delivery_date: order.deliveryDate ?? null,
    total_amount: order.totalAmount ?? 0,
    status: order.status,
    price_adjusted: !!order.priceAdjusted,
    sekolah: order.sekolah ?? null,
    sales: order.sales ?? null,
    pic_name: order.picName ?? null,
    phone: order.phone ?? null,
    remark: order.remark ?? null,
    due_date: order.dueDate ?? null,
    function_date: order.functionDate ?? null,
    logo_data_url: order.logoDataUrl ?? null,
    logo_file_name: order.logoFileName ?? null,
    school_type: order.schoolType ?? null,
    items: order.items ?? [],
    snapshot: order.snapshot ?? null,
    created_by: order.createdBy ?? null,
  };
}

function fromDbOrder(row) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    datePlaced: row.date_placed,
    deliveryDate: row.delivery_date,
    totalAmount: Number(row.total_amount),
    status: row.status,
    priceAdjusted: row.price_adjusted,
    sekolah: row.sekolah,
    sales: row.sales,
    picName: row.pic_name,
    phone: row.phone,
    remark: row.remark,
    dueDate: row.due_date,
    functionDate: row.function_date,
    logoDataUrl: row.logo_data_url,
    logoFileName: row.logo_file_name,
    schoolType: row.school_type,
    items: row.items || [],
    snapshot: row.snapshot,
    createdBy: row.created_by,
  };
}

// Fetches all orders, newest first.
export async function fetchOrders(userId, role) {
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
  if (role === 'teacher' && userId) {
    query = query.eq('created_by', userId);
  } else if (role === 'salesman' && userId) {
    const { data: assignments, error: assignError } = await supabase
      .from('salesman_assignments')
      .select('teacher_id')
      .eq('salesman_id', userId);
    if (assignError) throw assignError;
    const teacherIds = (assignments || []).map((a) => a.teacher_id);
    if (teacherIds.length === 0) return [];
    query = query.in('created_by', teacherIds);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data.map(fromDbOrder);
}

// Atomically reserves the next order number for `prefix` (e.g. "ORD-2026-")
// via the next_order_seq() Postgres function (supabase/migrations/0009) —
// a single database statement, so concurrent submissions can never be
// handed the same number. `minSeq` only matters the very first time a
// prefix is used; after that the database-side counter takes over.
export async function nextOrderSeq(prefix, minSeq) {
  const { data, error } = await supabase.rpc('next_order_seq', { p_prefix: prefix, p_min_seq: minSeq });
  if (error) throw error;
  return data;
}

export async function insertOrder(order) {
  const { error } = await supabase.from('orders').insert(toDbOrder(order));
  if (error) throw error;
}

// Partial update — only pass the camelCase fields that changed; fields
// absent from `patch` are left untouched in the row.
export async function updateOrder(id, patch) {
  const fullDbShape = toDbOrder({ id, ...patch });
  const dbPatch = {};
  Object.keys(fullDbShape).forEach((snakeKey) => {
    if (snakeKey === 'id') return;
    const camelKey = snakeKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (camelKey in patch) dbPatch[snakeKey] = fullDbShape[snakeKey];
  });
  const { error } = await supabase.from('orders').update(dbPatch).eq('id', id);
  if (error) throw error;
}
