-- These 4 tables belong to a different app (tested on the user's desktop
-- 2026-08-10) that shares this Supabase project — not the school-order-app
-- this repo builds. They were flagged "Unrestricted" in the dashboard,
-- meaning RLS was off entirely (any anon-key request had full CRUD, no
-- policy check at all).
--
-- This migration turns RLS on and adds the same permissive "allow anon"
-- policies used for `orders`, so behavior is unchanged (the other app keeps
-- working with no real auth of its own) but the RLS scaffold now exists —
-- tightening later (e.g. scoping to auth.uid() once that app has real
-- login) becomes a policy change instead of a first-time RLS setup.

alter table public.teachers enable row level security;
create policy "allow anon read" on public.teachers for select using (true);
create policy "allow anon insert" on public.teachers for insert with check (true);
create policy "allow anon update" on public.teachers for update using (true) with check (true);
create policy "allow anon delete" on public.teachers for delete using (true);

alter table public.order_items enable row level security;
create policy "allow anon read" on public.order_items for select using (true);
create policy "allow anon insert" on public.order_items for insert with check (true);
create policy "allow anon update" on public.order_items for update using (true) with check (true);
create policy "allow anon delete" on public.order_items for delete using (true);

alter table public.order_item_breakdown enable row level security;
create policy "allow anon read" on public.order_item_breakdown for select using (true);
create policy "allow anon insert" on public.order_item_breakdown for insert with check (true);
create policy "allow anon update" on public.order_item_breakdown for update using (true) with check (true);
create policy "allow anon delete" on public.order_item_breakdown for delete using (true);

alter table public.staff enable row level security;
create policy "allow anon read" on public.staff for select using (true);
create policy "allow anon insert" on public.staff for insert with check (true);
create policy "allow anon update" on public.staff for update using (true) with check (true);
create policy "allow anon delete" on public.staff for delete using (true);
