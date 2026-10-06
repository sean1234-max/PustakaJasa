-- A salesman can place a New Order on a school's behalf (Sean, 2026-10-06).
-- The order belongs to the school exactly like one the teacher placed
-- (created_by = that school's teacher account, so the teacher sees it and
-- can Add On / Amend it), with the salesman as its salesman, and
-- created_by_salesman recording who actually entered it. The teacher's own
-- New Order path is unchanged.

alter table public.orders
  add column created_by_salesman uuid references public.profiles(id);

-- School typeahead for the salesman's New Order: salesmen can't read teacher
-- profiles directly (profiles RLS), so this hands back only what the form
-- needs, for active schools whose name contains the typed text.
create or replace function public.search_schools(p_query text)
returns table (id uuid, sekolah text, school_language text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.sekolah, p.school_language
  from public.profiles p
  where public.current_role() in ('salesman', 'admin')
    and p.role = 'teacher'
    and p.status = 'active'
    and coalesce(trim(p_query), '') <> ''
    and p.sekolah ilike '%' || trim(p_query) || '%'
  order by p.sekolah
  limit 20;
$$;
revoke all on function public.search_schools(text) from public, anon;
grant execute on function public.search_schools(text) to authenticated;

create policy "salesman creates order for a school"
  on public.orders for insert
  with check (
    public.current_role() = 'salesman'
    and public.current_status() = 'active'
    and created_by_salesman = (select auth.uid())
    and salesman_id = (select auth.uid())
    and status = 'Reviewing Order'
    and reviewed_at is null
    and typed_at is null
    and exists (
      select 1 from public.profiles pr
      where pr.id = orders.created_by and pr.role = 'teacher' and pr.status = 'active'
    )
  );

-- A teacher's own insert must never claim a salesman entered it.
drop policy "teacher creates own orders" on public.orders;
create policy "teacher creates own orders"
  on public.orders for insert
  with check (
    created_by = (select auth.uid())
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Reviewing Order'
    and reviewed_at is null
    and typed_at is null
    and created_by_salesman is null
    and salesman_id is not null
    and exists (select 1 from public.profiles pr where pr.id = orders.salesman_id and pr.role = 'salesman')
  );

-- Order numbers and stock: the salesman's New Order needs the same two
-- calls the teacher's does.
create or replace function public.next_order_seq(p_prefix text, p_min_seq integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare v_seq integer;
begin
  if public.current_role() is distinct from 'teacher' and public.current_role() is distinct from 'salesman' then
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

-- plak_stock_deduct: same body, only its role check widened to salesman
-- (patched in place so the long stock logic isn't copied here).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.plak_stock_deduct(jsonb)'::regprocedure);
  if position($q$if public.current_role() is distinct from 'teacher' then$q$ in d) = 0 then
    raise exception 'plak_stock_deduct role check not found — update this migration';
  end if;
  d := replace(d, $q$if public.current_role() is distinct from 'teacher' then$q$,
                  $q$if coalesce(public.current_role(), '') not in ('teacher', 'salesman') then$q$);
  execute d;
end $$;
