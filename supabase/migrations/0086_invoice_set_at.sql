-- Sean, 2026-10-13: every Invoice ID shows the day it was entered,
-- "DWI-26100001 (9/10/26)", and who entered it (Production Manager can now
-- enter one too, when Store Admin forgot).
--
-- Stamped by the database the moment invoice_id goes from empty to a
-- number, whoever does it and from whichever page — never by the browser.
-- Changing the number later keeps the first stamp. Orders invoiced before
-- this have no date (it was never recorded).
--
-- The trigger is named to fire AFTER orders_write_guard_trigger (BEFORE
-- triggers run in name order), so the guard only ever sees the columns the
-- client sent; a client can't set these columns itself (Store Admin's guard
-- branch rejects any other column, and the stamp below always overwrites).

alter table public.orders
  add column if not exists invoice_set_at timestamptz,
  add column if not exists invoice_set_by_name text,
  add column if not exists invoice_set_by_role text;

create or replace function public.orders_invoice_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_role text;
begin
  if coalesce(old.invoice_id, '') = '' and coalesce(new.invoice_id, '') <> '' then
    select display_name, role into v_name, v_role from public.profiles where id = auth.uid();
    new.invoice_set_at := now();
    new.invoice_set_by_name := v_name;
    new.invoice_set_by_role := v_role;
  else
    new.invoice_set_at := old.invoice_set_at;
    new.invoice_set_by_name := old.invoice_set_by_name;
    new.invoice_set_by_role := old.invoice_set_by_role;
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_zz_invoice_stamp_trigger on public.orders;
create trigger orders_zz_invoice_stamp_trigger
  before update on public.orders
  for each row execute function public.orders_invoice_stamp();
