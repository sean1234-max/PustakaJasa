-- Sean, 2026-11-26: a FORM ANUGERAH the form bot filled remembers where it came from. The bot's reading of the
-- teacher's kertas kerja and the kertas kerja itself (order-imports, form-bot/kk-…) are kept here under an id the
-- bot writes into the Excel (custom property PJSB_FORM_FILL, telegram-bot/formFill.ts). When that Excel is
-- imported on the website the kertas kerja goes on the order by itself, and Add to Cart compares the plaques with
-- the reading (src/utils/kertasKerjaCheck.js) — plain code, no AI.
-- Only the bot (secret key) writes. Anyone logged in may read ONE row by its id (form_fill below) — the id is only
-- in that Excel, so nobody can list them.

create table if not exists public.form_fills (
  id          uuid primary key,
  created_at  timestamptz not null default now(),
  reading     jsonb not null,   -- { school, teacher, plaques, selempang, questions } as form_reads keeps it
  kk_path     text,             -- the kertas kerja in order-imports
  kk_name     text
);
alter table public.form_fills enable row level security;

create or replace function public.form_fill(p_id uuid)
returns table (reading jsonb, kk_path text, kk_name text)
language sql stable security definer set search_path = public
as $$
  select f.reading, f.kk_path, f.kk_name from public.form_fills f where f.id = p_id;
$$;
revoke all on function public.form_fill(uuid) from public, anon;
grant execute on function public.form_fill(uuid) to authenticated;
