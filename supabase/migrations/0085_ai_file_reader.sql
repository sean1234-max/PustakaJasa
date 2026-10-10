-- ============================================================================
-- AI sheet reader (universal file-reader plan, phase 1) — see the
-- `read-order-file` Edge Function and src/utils/aiMapping.js.
--
-- 1) file_read_runs: one row per AI reading of the sheets the rule-based
--    reader skipped. The model returns only a MAPPING (which rows/columns
--    hold what); the browser reads the values from the file itself. Same
--    sha-256 of the same sheets + same pipeline version = the stored mapping
--    is returned again, so one file always gives one answer.
-- 2) ai_settings + ai_month_spend_cents() + ai_budget_status(): ONE
--    site-wide monthly AI cap (owner, 2026-10-07: RM150), counting every AI
--    feature (this reader, the dormant extract-order-file, the grammar
--    check). Admin sees a banner at 80% and at 100%; at 100% AI calls stop
--    until the next month.
-- 3) Retention (owner, 2026-10-07: student names are kept 1 year): a daily
--    job clears the text-bearing columns of AI rows older than a year. It
--    never deletes rows (cost history stays) and never touches storage files.
-- ----------------------------------------------------------------------------

-- 1) Runs ------------------------------------------------------------------
create table public.file_read_runs (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references public.profiles(id),
  file_name        text not null,
  -- sha-256 of the structure-map text actually sent (fileIr.js
  -- renderIrText) — the cache key.
  input_sha256     text not null,
  pipeline_version text not null,
  route            text not null default 'ai-map' check (route in ('ai-map', 'cache')),
  status           text not null default 'processing'
                     check (status in ('processing', 'succeeded', 'failed', 'blocked')),
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  cache_read_tokens  integer,
  cache_write_tokens integer,
  cost_usd_cents   numeric(12,4),
  duration_ms      integer,
  mapping          jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index file_read_runs_created_by_created_at_idx on public.file_read_runs (created_by, created_at desc);
create index file_read_runs_created_at_idx on public.file_read_runs (created_at);
create index file_read_runs_cache_idx on public.file_read_runs (created_by, input_sha256, pipeline_version)
  where status = 'succeeded';

alter table public.file_read_runs enable row level security;
-- Written only by the Edge Function (service role). Reads: own runs; admin all.
create policy "select access" on public.file_read_runs
  for select using (public.current_role() = 'admin' or created_by = (select auth.uid()));

-- 2) Site-wide budget -------------------------------------------------------
create table public.ai_settings (
  id               boolean primary key default true check (id),
  monthly_cap_myr  numeric(10,2) not null default 150,
  usd_to_myr       numeric(8,4)  not null default 4.30,
  alert_pct        integer       not null default 80 check (alert_pct between 1 and 100),
  updated_at       timestamptz   not null default now()
);
insert into public.ai_settings (id) values (true) on conflict do nothing;

alter table public.ai_settings enable row level security;
create policy "admin read ai settings" on public.ai_settings
  for select using (public.current_role() = 'admin');
create policy "admin update ai settings" on public.ai_settings
  for update using (public.current_role() = 'admin') with check (public.current_role() = 'admin');

-- Every AI feature's spend this calendar month, Malaysia time, in US cents.
create or replace function public.ai_month_spend_cents()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with month_start as (
    select (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur') as t
  )
  select coalesce((select sum(cost_usd_cents) from public.file_read_runs, month_start where created_at >= month_start.t), 0)
       + coalesce((select sum(cost_usd_cents) from public.ai_extraction_runs, month_start where created_at >= month_start.t), 0)
       + coalesce((select sum(cost_usd_cents) from public.ai_grammar_checks, month_start where created_at >= month_start.t), 0);
$$;
revoke all on function public.ai_month_spend_cents() from public, anon, authenticated;
grant execute on function public.ai_month_spend_cents() to service_role;

-- For the admin banner (and the Edge Functions' cap check, via service role).
create or replace function public.ai_budget_status()
returns table (spent_myr numeric, cap_myr numeric, pct integer, alert_pct integer, blocked boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.ai_settings;
  spent numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' and public.current_role() is distinct from 'admin' then
    raise exception 'Only admins can read the AI budget.';
  end if;
  select * into s from public.ai_settings where id;
  spent := round(public.ai_month_spend_cents() / 100 * s.usd_to_myr, 2);
  return query select
    spent,
    s.monthly_cap_myr,
    case when s.monthly_cap_myr > 0 then floor(spent / s.monthly_cap_myr * 100)::integer else 100 end,
    s.alert_pct,
    spent >= s.monthly_cap_myr;
end;
$$;
revoke all on function public.ai_budget_status() from public, anon;
grant execute on function public.ai_budget_status() to authenticated, service_role;

-- 3) One-year retention of AI text --------------------------------------------
create or replace function public.clear_old_ai_text()
returns void
language sql
security definer
set search_path = public
as $$
  update public.file_read_runs set mapping = null
    where created_at < now() - interval '1 year' and mapping is not null;
  update public.ai_extraction_runs set raw_response = null, parsed_result = null
    where created_at < now() - interval '1 year' and (raw_response is not null or parsed_result is not null);
  update public.ai_grammar_checks set raw_response = null
    where created_at < now() - interval '1 year' and raw_response is not null;
$$;
revoke all on function public.clear_old_ai_text() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('clear-old-ai-text')
where exists (select 1 from cron.job where jobname = 'clear-old-ai-text');
-- 16:20 UTC == 00:20 Malaysia time.
select cron.schedule('clear-old-ai-text', '20 16 * * *', $$select public.clear_old_ai_text()$$);
