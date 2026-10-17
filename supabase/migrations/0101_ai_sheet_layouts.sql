-- ============================================================================
-- AI layout memory (Sean, 2026-10-17) — see supabase/functions/read-order-file/
-- layoutMemory.ts. The first time the AI reader maps an Excel sheet layout it
-- was sure of, the layout is kept here for EVERY user, so the next sheet laid
-- out the same way (any school) is read without an AI call.
--
-- A row holds only the layout: the header cells the AI pointed at (e.g.
-- "KUANTITI" in D6), which cells/columns hold what, and how often it was
-- used. No student names, classes or quantities.
--
-- Also: the reader's same-file cache is now shared by every user (same file
-- = same answer, whoever uploaded it), so it gets an index without
-- created_by.
--
-- Safe to run before or after the read-order-file function is redeployed:
-- the function works without this table (it just remembers nothing).
-- ----------------------------------------------------------------------------

create table if not exists public.ai_sheet_layouts (
  id               uuid primary key default gen_random_uuid(),
  -- sha-256 of the layout (layoutMemory.ts layoutKey): one row per layout.
  layout_key       text not null unique,
  pipeline_version text not null,
  role             text not null check (role in ('award-list', 'class-matrix')),
  anchors          jsonb not null,
  present          jsonb not null default '[]'::jsonb,
  template         jsonb not null,
  -- Who uploaded the file it was learned from, and that AI reading.
  created_by       uuid references public.profiles(id) on delete set null,
  source_run_id    uuid references public.file_read_runs(id) on delete set null,
  use_count        integer not null default 0,
  last_used_at     timestamptz,
  -- Admin can switch off a layout that reads wrongly:
  --   update ai_sheet_layouts set disabled = true where id = '...';
  disabled         boolean not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists ai_sheet_layouts_lookup_idx
  on public.ai_sheet_layouts (pipeline_version, use_count desc) where not disabled;

alter table public.ai_sheet_layouts enable row level security;
-- Written only by the Edge Function (service role). Admin can look.
drop policy if exists "admin read ai sheet layouts" on public.ai_sheet_layouts;
create policy "admin read ai sheet layouts" on public.ai_sheet_layouts
  for select using (public.current_role() = 'admin');
drop policy if exists "admin update ai sheet layouts" on public.ai_sheet_layouts;
create policy "admin update ai sheet layouts" on public.ai_sheet_layouts
  for update using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Counts a use of each layout (called by the Edge Function).
create or replace function public.ai_sheet_layouts_used(layout_ids uuid[])
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_sheet_layouts
     set use_count = use_count + 1, last_used_at = now()
   where id = any(layout_ids);
$$;
revoke all on function public.ai_sheet_layouts_used(uuid[]) from public, anon, authenticated;
grant execute on function public.ai_sheet_layouts_used(uuid[]) to service_role;

-- Same-file cache shared by every user.
create index if not exists file_read_runs_shared_cache_idx
  on public.file_read_runs (input_sha256, pipeline_version) where status = 'succeeded';
