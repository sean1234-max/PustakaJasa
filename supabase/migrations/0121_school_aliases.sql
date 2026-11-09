-- Salesmen type a school short (Sean, 2026-11-10): "skpp 14 (1)" is SK PUTRAJAYA PRESINT 14(1). When a
-- salesman picks the school ExcelFormAgent offered for what he typed, the short form is remembered here, so
-- the next time it is taken without asking. alias_key: the typed name in capitals, letters and digits only.
-- Only the bot (service role) reads and writes it.
create table if not exists public.school_aliases (
  alias_key   text primary key,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.school_aliases enable row level security;
