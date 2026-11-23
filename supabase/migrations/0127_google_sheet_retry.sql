-- Google's Sheets / Forms don't always answer (Sean, 2026-11-23: a 503 at 09:59 lost ORD-0591's Google Form, a
-- 2½-minute hang at 10:07 lost ORD-0572's Done Typing column I). fill-google-form now keeps what failed and
-- pg_cron calls it every 10 minutes (`{"action":"retry"}`) to try again, up to 12 tries within 2 days.

-- the salesman's words after "<school> (W) -", so a retry posts the same school text; how many tries so far
alter table public.google_form_fills
  add column if not exists note text,
  add column if not exists tries integer not null default 1;

-- Done Typing's MASTER LIST column I, one row per Done Typing (an invoice of a split order its own)
create table if not exists public.master_list_typed (
  id bigserial primary key,
  order_id text not null references public.orders(id) on delete cascade,
  qty integer not null,
  text text not null,                       -- "SITI (NOV)", fixed at Done Typing
  status text not null,                     -- pending / marked / not_found / failed (only pending + failed are retried)
  tries integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- only the function (secret key) reads and writes it
alter table public.master_list_typed enable row level security;

select cron.unschedule('google-sheet-retry') where exists (select 1 from cron.job where jobname = 'google-sheet-retry');
select cron.schedule(
  'google-sheet-retry',
  '*/10 * * * *',
  $$ select net.http_post(
       url := 'https://dlzkdkxbnbhgldsvbybt.supabase.co/functions/v1/fill-google-form',
       body := '{"action": "retry"}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
