-- Manual crystal artwork (Sean, 2026-10-19): beside Confirm Artwork the
-- salesman can press Manual. The crystal then leaves KIV & ARTWORK for Typing
-- like a confirmed one, but Production sees "MANUAL — Need designer design":
-- a designer draws it instead of the Crystal Studio preview.
--
-- The website sends artwork_confirmed_at with artwork_manual = true; the
-- stamp trigger keeps the flag only when it comes with that first
-- confirmation, so it can't be switched on or off later.

alter table public.orders add column if not exists artwork_manual boolean not null default false;

-- orders_write_guard: artwork_manual joins the artwork columns a teacher or
-- salesman may change on an approved order (patched in place, like 0098).
do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.orders_write_guard'::regproc);
  if position('artwork_manual' in d) = 0 then
    n := replace(d, E'- ''artwork_confirmed_by_role''', E'- ''artwork_confirmed_by_role'' - ''artwork_manual''');
    if n = d then raise exception 'orders_write_guard: nothing replaced'; end if;
    execute n;
  end if;
end $$;

create or replace function public.orders_artwork_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_role text;
begin
  if old.artwork_confirmed_at is null and new.artwork_confirmed_at is not null then
    select display_name, role into v_name, v_role from public.profiles where id = auth.uid();
    new.artwork_confirmed_at := now();
    new.artwork_confirmed_by_name := v_name;
    new.artwork_confirmed_by_role := v_role;
    new.artwork_manual := coalesce(new.artwork_manual, false);
  else
    new.artwork_confirmed_at := old.artwork_confirmed_at;
    new.artwork_confirmed_by_name := old.artwork_confirmed_by_name;
    new.artwork_confirmed_by_role := old.artwork_confirmed_by_role;
    new.artwork_manual := old.artwork_manual;
  end if;
  return new;
end;
$function$;

revoke execute on function public.orders_artwork_stamp() from public, anon, authenticated;
