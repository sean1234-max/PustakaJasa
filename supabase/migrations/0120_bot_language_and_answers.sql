-- The bots short and in each salesman's language (Sean, 2026-11-08).
-- bot_langs: a salesman's own choice ("/lang en" / "/lang zh" to ExcelFormAgent). With no row the bot goes
-- by his name: Fida, Nazrin, Wendy read English, every other salesman Chinese (telegram-bot i18n.ts).
create table if not exists public.bot_langs (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  lang        text not null check (lang in ('en', 'zh')),
  set_at      timestamptz not null default now()
);
alter table public.bot_langs enable row level security;

-- ReviewAgent asks a review's questions one at a time, with buttons: the answer to each (question number →
-- { pick, text }) and which one is being asked now (its message).
alter table public.order_auto_reviews
  add column if not exists answers jsonb not null default '{}'::jsonb,
  add column if not exists asking integer,
  add column if not exists asking_message_id bigint;
