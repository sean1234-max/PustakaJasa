-- ============================================================================
-- "Generate AI File" job queue (Production order page -> local Illustrator
-- automation). The website only writes a job row (combined CSV content +
-- filename, same shape as the existing "Download Combined CSV" export); a
-- local watcher script on the Illustrator machine polls for pending jobs
-- using the service role key (bypasses RLS below entirely, same as any
-- other service-role background job in this project), runs SEAN.jsx against
-- the CSV via AppleScript, uploads the resulting OUTPUT.ai file(s) to the
-- new `ai-file-outputs` bucket, and writes the result back onto the row.
--
-- Operator-name entry stays as Illustrator's own popup (askOperatorName in
-- SEAN.jsx) -- deliberately NOT auto-filled from the website login, so a
-- physically-present staff member always types who actually ran it.
-- ----------------------------------------------------------------------------
create table public.ai_file_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  filename text not null,
  csv_content text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'error')),
  result_message text,
  output_paths text[] not null default '{}',
  requested_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ai_file_jobs_status_idx on public.ai_file_jobs (status);
create index ai_file_jobs_order_id_idx on public.ai_file_jobs (order_id);

alter table public.ai_file_jobs enable row level security;

-- Website side: Production/Store Admin/Admin can queue a job and watch its
-- status. Nobody but the (RLS-bypassing) service role can move status past
-- 'pending' or fill in output_paths -- the watcher owns that.
create policy "staff read ai file jobs" on public.ai_file_jobs
  for select using (public.current_role() in ('production', 'store_admin', 'admin'));
create policy "staff create ai file jobs" on public.ai_file_jobs
  for insert with check (public.current_role() in ('production', 'store_admin', 'admin'));

-- ----------------------------------------------------------------------------
-- Generated .ai output files -- private, service-role-written only. Staff
-- can read/download once the watcher lists a path on their job's
-- output_paths.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('ai-file-outputs', 'ai-file-outputs', false, 104857600) -- 100 MiB
on conflict (id) do nothing;

create policy "staff read ai file outputs" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ai-file-outputs'
    and public.current_role() in ('production', 'store_admin', 'admin')
  );
