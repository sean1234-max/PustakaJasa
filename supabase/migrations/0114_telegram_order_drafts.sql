-- A salesman's order prepared from Telegram (Sean, 2026-11-05). The salesman sends ExcelFormAgent the
-- FORM ANUGERAH with the Function Details list in the caption (SEKOLAH / CIKGU / PHONE / KETUA PANITIA /
-- TERMS / SHIPMENT DATE / FUNCTION DATE); the bot keeps the file and the details as a draft and replies
-- with a link. Opening it on the website (signed in as that salesman) fills New Order with both — the
-- salesman checks it and submits as usual, so every website check still runs. The bot never submits.
--
--   telegram_links       — which website account a Telegram user is (one per salesman)
--   telegram_link_codes  — the one-time code the salesman's dashboard shows; sent to the bot, it links
--   order_drafts         — the drafts; the Excel is in order-imports/<salesman id>/ (0046), readable by
--                          that salesman only

create table if not exists public.telegram_links (
  telegram_user_id bigint primary key,
  profile_id       uuid not null unique references public.profiles(id) on delete cascade,
  linked_at        timestamptz not null default now()
);
alter table public.telegram_links enable row level security;
create policy "read own telegram link" on public.telegram_links for select using (profile_id = auth.uid());

create table if not exists public.telegram_link_codes (
  code       text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);
alter table public.telegram_link_codes enable row level security;

-- A fresh code for the signed-in salesman, valid 15 minutes (the old one goes)
create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text;
begin
  if public.current_role() is distinct from 'salesman' then
    raise exception 'Only salesmen can link Telegram.';
  end if;
  delete from public.telegram_link_codes where profile_id = auth.uid() or expires_at < now();
  loop
    v_code := lpad(floor(random() * 1000000)::int::text, 6, '0');
    begin
      insert into public.telegram_link_codes (code, profile_id, expires_at) values (v_code, auth.uid(), now() + interval '15 minutes');
      return v_code;
    exception when unique_violation then
      -- taken by someone else's live code: draw again
    end;
  end loop;
end $$;
revoke all on function public.create_telegram_link_code() from public, anon;
grant execute on function public.create_telegram_link_code() to authenticated;

create table if not exists public.order_drafts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  fields     jsonb not null default '{}'::jsonb,   -- sekolah, picName, phone, ketuaPanitia, terms, shipmentDate, functionDate (YYYY-MM-DD)
  file_path  text,
  file_name  text
);
alter table public.order_drafts enable row level security;
create policy "read own order drafts" on public.order_drafts for select using (profile_id = auth.uid());
