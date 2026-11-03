-- Telegram notices for Production (Sean, 2026-11-04; supabase/functions/telegram-notify): a message
-- when an order comes in for review and a morning summary. pg_cron calls the function every
-- 5 minutes; telegram_sent remembers what has been sent so nothing goes out twice.

create extension if not exists pg_net;

create table if not exists public.telegram_sent (
  key text primary key,           -- 'new:ORD-0257', 'summary:2026-11-05'
  sent_at timestamptz not null default now()
);
-- only the function (secret key) reads and writes it
alter table public.telegram_sent enable row level security;

-- Orders already waiting when this goes live count as announced: no flood of old orders.
insert into public.telegram_sent (key)
select 'new:' || id from public.orders
where status = 'Reviewing Order' and reviewed_at is null and cancelled_at is null
on conflict (key) do nothing;

select cron.unschedule('telegram-notify') where exists (select 1 from cron.job where jobname = 'telegram-notify');
select cron.schedule(
  'telegram-notify',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://dlzkdkxbnbhgldsvbybt.supabase.co/functions/v1/telegram-notify',
       body := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb
     ) $$
);
