-- Production keys in a New Order for a salesman / teacher (Sean, 2026-11-11): the school is picked as a
-- salesman does (search_schools, the school's teacher account owns it), the salesman from every salesman.
-- created_by_production records who keyed it in — the salesman is charged 1.5% of the order total for it
-- (the urgent Google Sheet's "1.5%" tab, written at invoice by sync-urgent-order-sheet). Same flow after
-- submit: Reviewing Order -> Done Review -> salesman Approve (his Google Form filled) -> invoice.

alter table public.orders add column if not exists created_by_production uuid references public.profiles(id);

create policy "production keys in an order for a school" on public.orders for insert
with check (
  public.current_role() = 'production' and public.current_status() = 'active'
  and created_by_production = (select auth.uid())
  and created_by_salesman is null
  and status = 'Reviewing Order' and reviewed_at is null and typed_at is null
  and public.is_active_school(created_by)
  and exists (select 1 from public.profiles pr where pr.id = orders.salesman_id and pr.role = 'salesman')
);

-- a production account not assigned to that salesman still sees the orders it keyed in
create policy "production reads orders it keyed in" on public.orders for select
using (public.current_role() = 'production' and created_by_production = (select auth.uid()));

create or replace function public.next_order_seq(p_prefix text, p_min_seq integer default 1)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_seq integer;
begin
  if public.current_role() is null or public.current_role() not in ('teacher', 'salesman', 'production') then
    raise exception 'Not allowed.';
  end if;
  loop
    update public.order_number_counters set next_seq = next_seq + 1 where prefix = p_prefix returning next_seq - 1 into v_seq;
    exit when found;
    begin
      insert into public.order_number_counters (prefix, next_seq) values (p_prefix, p_min_seq + 1);
      v_seq := p_min_seq; exit;
    exception when unique_violation then end;
  end loop;
  return v_seq;
end;
$function$;

create or replace function public.search_schools(p_query text)
returns table(id uuid, sekolah text, school_language text)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, p.sekolah, p.school_language
  from public.profiles p
  where public.current_role() in ('salesman', 'production', 'admin')
    and p.role = 'teacher'
    and p.status = 'active'
    and coalesce(trim(p_query), '') <> ''
    and p.sekolah ilike '%' || trim(p_query) || '%'
  order by p.sekolah
  limit 20;
$function$;
