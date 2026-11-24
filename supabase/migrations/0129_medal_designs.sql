-- Sean, 2026-11-24: medal designs. Every medal design lives in E CUT 0 as a group named "DESIGN <n>";
-- Production's MEDAL DESIGNS page reads them through the AI File helper (v8) and keeps one row each here,
-- the pictures in the "medal-designs" bucket (named by their SHA-1, so a picture never changes under its
-- name). A new design comes in hidden; Production publishes it, then salesmen can pick it (phase 2).
-- A design no longer in E CUT 0 keeps its row (in_file false) so older orders still find it.
--   name        the group's name in E CUT 0 — what the CSV's `design` column will carry; never renamed
--   label       the name salesmen see ("Arc", "Ornament" …), blank = the name
--   preview     the export: { main, thumb, picture, templates } as templates.json, picture names → the bucket

create table if not exists public.medal_designs (
  name text primary key check (name ~ '^DESIGN [0-9]+$'),
  label text not null default '' check (char_length(label) <= 60),
  hidden boolean not null default true,
  sort_order integer not null default 0,
  in_file boolean not null default true,
  preview jsonb not null,
  updated_at timestamptz not null default now()
);

revoke all on public.medal_designs from anon;
grant select, insert, update on public.medal_designs to authenticated;
alter table public.medal_designs enable row level security;

-- every active account reads (the order pages will show the designs); Production / Admin change them
drop policy if exists "medal_designs read" on public.medal_designs;
create policy "medal_designs read" on public.medal_designs for select to authenticated
  using (public.current_status() = 'active');
drop policy if exists "medal_designs add" on public.medal_designs;
create policy "medal_designs add" on public.medal_designs for insert to authenticated
  with check (public.current_status() = 'active' and public.current_role() in ('production', 'admin'));
drop policy if exists "medal_designs change" on public.medal_designs;
create policy "medal_designs change" on public.medal_designs for update to authenticated
  using (public.current_status() = 'active' and public.current_role() in ('production', 'admin'))
  with check (public.current_status() = 'active' and public.current_role() in ('production', 'admin'));

-- pictures: public to read (shown on the order pages), PNG only, 5 MB each; only Production / Admin add
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('medal-designs', 'medal-designs', true, 5242880, array['image/png'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/png'];

drop policy if exists "medal design pictures: add" on storage.objects;
create policy "medal design pictures: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'medal-designs' and public.current_status() = 'active' and public.current_role() in ('production', 'admin'));
