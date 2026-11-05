-- Every AI call the Telegram bots make, with its cost (Sean, 2026-11-05): until now only the website's
-- AI features were counted, so the RM150 monthly cap and the spend figures missed the bots — the
-- Anthropic credit ran out while the site showed RM20. Also Sean's own word on the credit balance
-- (ai_balance: "I topped up, the balance is now $X"), so the assistant can warn him before it runs out —
-- Anthropic has no way for a program to read the balance itself.

create table if not exists public.ai_usage (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  feature        text not null,            -- e.g. read_form, compare_result, read_changes, assistant
  model          text,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd_cents numeric(12,4) not null default 0,
  file_name      text,
  error          text
);
create index if not exists ai_usage_created on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
create policy "admin read ai usage" on public.ai_usage for select using (public.current_role() = 'admin');

create table if not exists public.ai_balance (
  id         bigint generated always as identity primary key,
  set_at     timestamptz not null default now(),
  amount_usd numeric(10,2) not null check (amount_usd >= 0),
  set_by     text
);
alter table public.ai_balance enable row level security;

-- Every AI feature's spend since a moment, in US cents
create or replace function public.ai_spend_cents_since(since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(cost_usd_cents) from public.file_read_runs where created_at >= since), 0)
       + coalesce((select sum(cost_usd_cents) from public.ai_extraction_runs where created_at >= since), 0)
       + coalesce((select sum(cost_usd_cents) from public.ai_grammar_checks where created_at >= since), 0)
       + coalesce((select sum(cost_usd_cents) from public.ai_usage where created_at >= since), 0);
$$;

-- This calendar month (Malaysia time) — now with the bots too
create or replace function public.ai_month_spend_cents()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select public.ai_spend_cents_since(date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur');
$$;

-- The balance Sean last gave, what has been spent since, and what is left (an estimate)
create or replace function public.ai_balance_estimate()
returns table (balance_id bigint, set_at timestamptz, set_usd numeric, spent_usd numeric, left_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.set_at, b.amount_usd,
         round(public.ai_spend_cents_since(b.set_at) / 100, 2),
         round(b.amount_usd - public.ai_spend_cents_since(b.set_at) / 100, 2)
  from public.ai_balance b order by b.set_at desc limit 1;
$$;

-- AI calls refused for want of credit since a moment (website features and bots), for the alert
create or replace function public.ai_credit_errors_since(since timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.file_read_runs where created_at >= since and error ilike '%credit balance%')
       + (select count(*) from public.ai_extraction_runs where created_at >= since and error ilike '%credit balance%')
       + (select count(*) from public.ai_grammar_checks where created_at >= since and error ilike '%credit balance%')
       + (select count(*) from public.ai_usage where created_at >= since and error ilike '%credit balance%');
$$;

revoke all on function public.ai_credit_errors_since(timestamptz) from public, anon, authenticated;
revoke all on function public.ai_spend_cents_since(timestamptz) from public, anon, authenticated;
revoke all on function public.ai_balance_estimate() from public, anon, authenticated;
