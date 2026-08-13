-- Tracks administrative actions taken through the new Admin Portal (account
-- creation, password resets, status changes, salesman reassignment, and
-- admin-performed catalog/reference-image edits). Deliberately app-level
-- (a plain insert from src/lib/adminApi.js after each successful action)
-- rather than trigger-based change-data-capture — matches this project's
-- existing style (no triggers anywhere) and the spec's explicit list of
-- action types to record, not a full audit of every column change.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id),
  action text not null,
  target_table text,
  target_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- Only admins may write, and only ever attributing the row to themselves —
-- stops anyone from forging a log entry under another admin's name. Only
-- admins may read (this is an internal accountability trail, not
-- user-facing data). Never contains password values — enforced by
-- convention in adminApi.js's logAdminAction(), not by the schema, since
-- Postgres can't know what a JSON blob "means".
create policy "admin writes own audit rows" on public.audit_log
  for insert with check (admin_id = auth.uid() and public.current_role() = 'admin');
create policy "admin reads audit log" on public.audit_log
  for select using (public.current_role() = 'admin');
