-- ============================================================================
-- Audit + cost trail for the AI engraving-text check — one row per call to
-- the `check-engraving-text` Edge Function (triggered when a teacher clicks
-- Add to Cart). Same shape / same rules as ai_extraction_runs (0045):
--
--   * written ONLY by the Edge Function (service role) — never the browser
--   * nothing references a row; it just records that a check happened
--   * safe to truncate
--
-- The check is advisory only — its result never changes an order and never
-- blocks Add to Cart. This table exists so the Edge Function can enforce a
-- per-user hourly rate limit + monthly cost cap, and so Admin can see AI
-- spend.
-- ----------------------------------------------------------------------------
create table public.ai_grammar_checks (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid not null references public.profiles(id),

  lines_checked  integer,
  issues_found   integer,

  status         text not null default 'processing'
                   check (status in ('processing', 'succeeded', 'failed', 'rate_limited', 'cost_capped')),
  model              text,
  prompt_tokens      integer,
  completion_tokens  integer,
  cost_usd_cents     numeric(12,4),

  raw_response   jsonb,
  error          text,

  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

create index ai_grammar_checks_created_by_created_at_idx
  on public.ai_grammar_checks (created_by, created_at desc);
create index ai_grammar_checks_created_at_idx
  on public.ai_grammar_checks (created_at);

alter table public.ai_grammar_checks enable row level security;

-- No insert/update/delete policy — only the service-role Edge Function writes.
create policy "read own grammar checks" on public.ai_grammar_checks
  for select using (created_by = auth.uid());
create policy "admins read all grammar checks" on public.ai_grammar_checks
  for select using (public.current_role() = 'admin');
