-- The form bot's readings of a kertas kerja, kept so the same file isn't paid for twice (Sean,
-- 2026-11-05; supabase/functions/telegram-bot formCache.ts). key = SHA-256 of the reading version,
-- the salesman's notes and the file content. Only the bot function (secret key) reads and writes it.

create table if not exists public.form_reads (
  key        text primary key,
  created_at timestamptz not null default now(),
  file_name  text,
  result     jsonb not null
);
alter table public.form_reads enable row level security;
