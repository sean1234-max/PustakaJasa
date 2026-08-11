-- Replaces the pre-existing `orders` table (teacher_id/event_date/remarks
-- schema from a different app/test) with the schema this app needs.
-- Confirmed destructive by the user — the 2 existing rows are discarded.
drop table if exists public.orders cascade;

create table public.orders (
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

create policy "allow anon read" on public.orders for select using (true);
create policy "allow anon insert" on public.orders for insert with check (true);
create policy "allow anon update" on public.orders for update using (true) with check (true);
create policy "allow anon delete" on public.orders for delete using (true);
