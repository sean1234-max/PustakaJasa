-- Telegram review list (Sean, 2026-11-04; supabase/functions/telegram-notify): one message a day that
-- lists every order in Reviewing Order — ✅ once Done Review — and is edited in place as orders come
-- and go. telegram_sent keeps that message's id and what it last said; the check runs every 3 minutes.

alter table public.telegram_sent
  add column if not exists message_id bigint,   -- the Telegram message to edit ('live:<day>' rows)
  add column if not exists body_hash text;      -- what it says now, so an unchanged list isn't re-sent

select cron.unschedule('telegram-notify') where exists (select 1 from cron.job where jobname = 'telegram-notify');
select cron.schedule(
  'telegram-notify',
  '*/3 * * * *',
  $$ select net.http_post(
       url := 'https://dlzkdkxbnbhgldsvbybt.supabase.co/functions/v1/telegram-notify',
       body := '{}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb
     ) $$
);
