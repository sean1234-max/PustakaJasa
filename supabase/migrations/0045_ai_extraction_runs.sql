-- ============================================================================
-- Batch C (Phase 4 AI order-import). Audit + cost trail for the AI order-file
-- extraction — one row per attempt to read an uploaded .xlsx/.docx with the
-- model (see Batch D's `extract-order-file` Edge Function).
--
-- Written ONLY by the Edge Function (service role, bypasses RLS) — never by
-- the browser — so a row is a trustworthy record of what the model was asked
-- and what it cost. Nothing on an order references a run; a run just records
-- that an import happened. This table is safe to truncate.
-- ----------------------------------------------------------------------------
create table public.ai_extraction_runs (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references public.profiles(id),

  -- The uploaded file this run read. `storage_path` is the object key in the
  -- private `order-imports` bucket (0046). `file_hash` is a sha-256 of the
  -- bytes, so a re-upload of the identical file can reuse a prior successful
  -- run instead of paying the model again.
  file_name     text not null,
  file_hash     text,
  storage_path  text,

  -- 'processing' -> 'succeeded' | 'needs_human' | 'failed'.
  -- 'needs_human' = the model ran but its output never passed schema
  -- validation even after the one retry; the teacher falls back to the
  -- deterministic parser / manual entry.
  status        text not null default 'processing'
                  check (status in ('processing', 'succeeded', 'needs_human', 'failed')),
  attempt       smallint not null default 1,   -- 1 or 2 — one automatic retry, no more

  model             text,
  prompt_tokens     integer,
  completion_tokens integer,
  cost_usd_cents    numeric(12,4),             -- model-billed cost of this run, in US cents

  -- The model's raw JSON reply (for debugging a bad extraction) and the
  -- validated result actually handed back to the browser. Both size-capped
  -- by the Edge Function before insert.
  raw_response  jsonb,
  parsed_result jsonb,
  error         text,

  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- Cost dashboard (Batch F) and the Edge Function's own per-user monthly cap
-- both read "this user's runs, newest first / within this month".
create index ai_extraction_runs_created_by_created_at_idx
  on public.ai_extraction_runs (created_by, created_at desc);

-- The 90-day retention sweep (see 0046) scans by age.
create index ai_extraction_runs_created_at_idx
  on public.ai_extraction_runs (created_at);

-- Identical-file reuse lookup.
create index ai_extraction_runs_file_hash_idx
  on public.ai_extraction_runs (file_hash)
  where file_hash is not null;

alter table public.ai_extraction_runs enable row level security;

-- Deliberately NO insert/update/delete policy: an ordinary authenticated
-- session can do none of those. Only the Edge Function writes here, and it
-- uses the service role (RLS does not apply). Reads: a teacher sees their
-- own runs (to poll status / show "reading…"); admins see all (Batch F cost
-- view). Matches 0014 audit_log's "internal accountability trail" shape.
create policy "read own extraction runs" on public.ai_extraction_runs
  for select using (created_by = auth.uid());
create policy "admins read all extraction runs" on public.ai_extraction_runs
  for select using (public.current_role() = 'admin');
