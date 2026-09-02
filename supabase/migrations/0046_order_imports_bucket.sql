-- ============================================================================
-- Batch C (Phase 4 AI order-import). Private Storage bucket for the raw
-- teacher-uploaded order files the AI extraction reads (Batch D's
-- `extract-order-file`).
--
-- UNLIKE `logos` (public — 0034/0043), these are a school's unpublished order
-- working documents: strictly private, readable only by the account that
-- uploaded them (and the Edge Function via the service role, which bypasses
-- RLS). The browser uploads here first, then calls extract-order-file with
-- the resulting object path.
--
-- Object key convention: `order-imports/<auth.uid()>/<sha256>.xlsx` — every
-- account is boxed into its own user-id folder by the policies below.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-imports',
  'order-imports',
  false,
  5242880,  -- 5 MiB. Real order files seen so far: 120-330 KiB.
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        -- .xlsx
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  -- .docx
    'application/octet-stream'   -- some browsers send this for .xlsx/.docx uploads
  ]
)
on conflict (id) do nothing;

-- (storage.foldername(name))[1] is the first path segment — the uploader's
-- own user id. Each account can only touch objects under its own folder.
create policy "upload own order imports" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'order-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "read own order imports" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'order-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "replace own order imports" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'order-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "delete own order imports" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'order-imports'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ----------------------------------------------------------------------------
-- RETENTION (90 days) — NOT automated in this migration.
--
-- Deleting a Storage object safely from plain SQL needs pg_net + a stored
-- service key (neither is set up on this project — pg_cron and pg_net are
-- both available but uninstalled). So the sweep will run from the Edge
-- Function side instead, where the service role can call
-- storage.remove([...]) properly: either a scheduled `cleanup-order-imports`
-- function, or `extract-order-file` opportunistically removing the caller's
-- own files older than 90 days on each run. Tracked as a Batch D follow-up.
-- The order + its extracted data are permanent regardless — only the raw
-- upload is time-limited. ai_extraction_runs_created_at_idx (0045) is
-- already in place to make the sweep cheap.
-- ----------------------------------------------------------------------------
