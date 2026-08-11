-- Orders table: mirrors the shape of the in-memory order objects used by
-- src/state/AppState.jsx. Nested/variable-shape data (cart items, category
-- draft snapshot) is kept as jsonb rather than fully normalized, since the
-- app already treats them as flexible blobs and the schema would otherwise
-- have to encode every award-category's ad hoc field layout.
create table if not exists public.orders (
  id text primary key,
  invoice_id text,
  date_placed text,
  delivery_date text,
  total_amount numeric not null default 0,
  status text not null default 'Submitted to Sales',
  price_adjusted boolean not null default false,
  sekolah text,
  sales text,
  pic_name text,
  phone text,
  remark text,
  due_date text,
  function_date text,
  logo_data_url text,
  logo_file_name text,
  items jsonb not null default '[]'::jsonb,
  snapshot jsonb,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

-- This app has no real Supabase Auth yet (login is a hardcoded fake check
-- in src/data/accounts.js) — role gating happens client-side only. These
-- policies intentionally allow full access via the anon/publishable key so
-- the prototype keeps working. Before this ever handles real school/order
-- data, replace with Supabase Auth + policies scoped to auth.uid()/role.
create policy "allow anon read" on public.orders for select using (true);
create policy "allow anon insert" on public.orders for insert with check (true);
create policy "allow anon update" on public.orders for update using (true) with check (true);
