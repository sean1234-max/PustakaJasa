-- A small, manually-ticked "go-live readiness" checklist Admin sees on
-- their Dashboard — tracks infra/performance to-dos found by the Supabase
-- performance advisor (see get_advisors) that this app can't verify live
-- itself (some are Supabase project settings, not database state). The
-- human-readable label for each key lives in AdminDashboard.jsx, not here —
-- this table only tracks done/undone so the wording can change freely
-- without a migration.
create table public.ops_checklist_items (
  key text primary key,
  done boolean not null default false,
  done_at timestamptz,
  done_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.ops_checklist_items enable row level security;

create policy "admin reads checklist" on public.ops_checklist_items
  for select using (public.current_role() = 'admin');
create policy "admin writes checklist" on public.ops_checklist_items
  for insert with check (public.current_role() = 'admin');
create policy "admin updates checklist" on public.ops_checklist_items
  for update using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Seeded from the 2026-09-17 performance advisor pass. auth_connection_percentage
-- is already done — the user switched Supabase Auth's connection allocation
-- strategy from Absolute to Percentage in the Dashboard the same day.
insert into public.ops_checklist_items (key, done, done_at) values
  ('auth_connection_percentage', true, now()),
  ('rls_initplan_optimization', false, null),
  ('rls_consolidate_multiple_policies', false, null),
  ('missing_fk_indexes', false, null)
on conflict (key) do nothing;
