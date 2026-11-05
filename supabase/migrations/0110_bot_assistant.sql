-- The Production group's bot as Sean's assistant (Sean, 2026-11-05; supabase/functions/telegram-bot
-- assistant.ts, telegram-notify reports.ts):
--   bot_tasks — Sean's to-do list ("remember me: 1. help Harriet convert the Excel"); listed in the
--               morning report and the evening summary, ticked off when he says it's done.
--   bot_chat  — the last few things said in the group, so the bot follows the conversation.
-- Only the bot functions (secret key) read and write them.

create table if not exists public.bot_tasks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  text text not null,
  due_date date,                 -- Malaysia day, when Sean gave one
  done_at timestamptz,
  created_by text
);
create index if not exists bot_tasks_open on public.bot_tasks (id) where done_at is null;
alter table public.bot_tasks enable row level security;

create table if not exists public.bot_chat (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user', 'assistant')),
  text text not null
);
alter table public.bot_chat enable row level security;
