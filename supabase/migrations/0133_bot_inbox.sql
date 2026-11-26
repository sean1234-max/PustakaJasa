-- Sean, 2026-11-26: the form bot waits for the salesman to finish before it reads what he sent — a kertas kerja,
-- and what to do with it in a message of its own. Each message waits here; when 15 seconds pass with nothing new
-- from him, the last message's run takes them all (telegram-bot/inbox.ts). The first message of a batch gets a
-- "Reading message…" reply, taken off when the batch is read. Rows go after 7 days.
-- Only the bot (secret key) uses it: RLS on, no policies.

create table if not exists public.bot_inbox (
  chat_id           bigint not null,
  telegram_user_id  bigint not null,
  message_id        bigint not null,
  msg               jsonb not null,
  taken             boolean not null default false,
  status_message_id bigint,          -- the bot's "Reading message…" for the batch this message started
  created_at        timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists bot_inbox_waiting on public.bot_inbox (chat_id, telegram_user_id, taken);
alter table public.bot_inbox enable row level security;
