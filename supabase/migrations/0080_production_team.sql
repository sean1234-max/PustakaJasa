-- Production team split (Sean, 2026-10-06). Mirrors the Store Admin manager
-- + assigned-salesmen setup (0039 / 0069), for the production role:
-- • A production account flagged `is_production_manager` (production@pjsb.com)
--   sees every order, manages the Catalog, assigns salesmen to production
--   accounts and creates new production accounts (admin-user-ops).
-- • Any other production account sees — and can work on — only the orders of
--   the salesmen assigned to it (production_salesman_assignments). A salesman
--   belongs to at most one production account; an unassigned salesman's
--   orders are seen by the manager only.
-- • Catalog changes (prices, stock, hide, reference images) are manager-only;
--   the others can still view it.
-- • sean@pjsb.com moves from salesman to production, taking 9 salesmen.

begin;

-- ── Manager flag ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists is_production_manager boolean not null default false;
alter table public.profiles drop constraint if exists profiles_production_manager_is_production;
alter table public.profiles add constraint profiles_production_manager_is_production
  check (not is_production_manager or role = 'production');

update public.profiles set is_production_manager = true
 where role = 'production' and lower(email) = 'production@pjsb.com';

create or replace function public.is_production_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_production_manager from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.is_production_manager() from public, anon;
grant execute on function public.is_production_manager() to authenticated;

-- ── Which production account works which salesman's orders ─────────────────
create table if not exists public.production_salesman_assignments (
  salesman_id uuid primary key references public.profiles(id) on delete cascade,
  production_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.production_salesman_assignments enable row level security;

create or replace function public.my_production_salesman_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select salesman_id from public.production_salesman_assignments where production_id = auth.uid();
$$;
revoke execute on function public.my_production_salesman_ids() from public, anon;
grant execute on function public.my_production_salesman_ids() to authenticated;

-- The production manager (or Admin) manages it; a production account reads
-- its own rows. Only a real salesman → a non-manager production account.
create policy "read production assignments" on public.production_salesman_assignments
  for select using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and (public.is_production_manager() or production_id = (select auth.uid())))
  );
create policy "manage production assignments" on public.production_salesman_assignments
  for all using (
    public.current_role() = 'admin'
    or (public.current_role() = 'production' and public.current_status() = 'active' and public.is_production_manager())
  ) with check (
    (public.current_role() = 'admin'
      or (public.current_role() = 'production' and public.current_status() = 'active' and public.is_production_manager()))
    and exists (select 1 from public.profiles s where s.id = salesman_id and s.role = 'salesman')
    and exists (select 1 from public.profiles p where p.id = production_id and p.role = 'production' and not p.is_production_manager)
  );

-- The manager lists the production accounts (salesmen are already readable).
create policy "production manager reads production profiles" on public.profiles
  for select using (
    role = 'production' and public.current_role() = 'production' and public.is_production_manager()
  );

-- ── Orders: production sees / updates only its salesmen's (manager: all) ────
drop policy "select access" on public.orders;
create policy "select access" on public.orders for select using (
  public.current_role() = 'admin'
  or (public.current_role() = 'production'
      and (public.is_production_manager() or salesman_id in (select public.my_production_salesman_ids())))
  or (public.current_role() = 'salesman' and public.is_sales_manager())
  or salesman_id = (select auth.uid())
  or (public.current_role() = 'store_admin' and salesman_id in (select public.my_assigned_invoicing_salesman_ids()))
  or created_by = (select auth.uid())
);

drop policy "update access" on public.orders;
create policy "update access" on public.orders for update using (
  public.current_role() = 'admin'
  or (public.current_role() = 'production'
      and (public.is_production_manager() or salesman_id in (select public.my_production_salesman_ids())))
  or salesman_id = (select auth.uid())
  or (public.current_role() = 'store_admin' and salesman_id in (select public.my_assigned_invoicing_salesman_ids()))
  or created_by = (select auth.uid())
) with check (
  public.current_role() = 'admin'
  or (public.current_role() = 'production'
      and (public.is_production_manager() or salesman_id in (select public.my_production_salesman_ids())))
  or salesman_id = (select auth.uid())
  or (public.current_role() = 'store_admin' and salesman_id in (select public.my_assigned_invoicing_salesman_ids()))
  or created_by = (select auth.uid())
);

-- ── Catalog: changes are the production manager's (and Admin's) only ───────
do $$
declare
  t text;
  rule text := '(public.current_role() = ''admin'' or (public.current_role() = ''production'' '
            || 'and public.current_status() = ''active'' and public.is_production_manager()))';
begin
  foreach t in array array['plak_catalog_nodes', 'plak_stock_groups', 'catalog_reference_images'] loop
    execute format('drop policy "insert access" on public.%I', t);
    execute format('drop policy "update access" on public.%I', t);
    execute format('drop policy "delete access" on public.%I', t);
    execute format('create policy "insert access" on public.%I for insert with check %s', t, rule);
    execute format('create policy "update access" on public.%I for update using %s with check %s', t, rule, rule);
    execute format('create policy "delete access" on public.%I for delete using %s', t, rule);
  end loop;
end $$;

create or replace function public.plak_node_set_stock(p_id uuid, p_new_stock integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.current_role() = 'admin'
          or (public.current_role() = 'production' and public.current_status() = 'active' and public.is_production_manager())) then
    raise exception 'Not authorized.';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock must be zero or greater.';
  end if;

  update public.plak_catalog_nodes
  set stock_qty = greatest(coalesce(stock_qty, 0) + (p_new_stock - coalesce(stock_baseline, 0)), 0),
      stock_baseline = p_new_stock
  where id = p_id;
end;
$function$;

create or replace function public.plak_stock_group_set_stock(p_key text, p_new_stock integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.current_role() = 'admin'
          or (public.current_role() = 'production' and public.current_status() = 'active' and public.is_production_manager())) then
    raise exception 'Not authorized.';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock must be zero or greater.';
  end if;

  update public.plak_stock_groups
  set stock_qty = greatest(coalesce(stock_qty, 0) + (p_new_stock - coalesce(stock_baseline, 0)), 0),
      stock_baseline = p_new_stock
  where key = p_key;
end;
$function$;

-- ── sean@pjsb.com: salesman → production, with his 9 salesmen ──────────────
-- He no longer takes orders as a salesman: drop him from Store Admins'
-- salesman lists. His existing (test) orders keep him as their salesman_id.
delete from public.invoicing_salesman_assignments
 where salesman_id = (select id from public.profiles where lower(email) = 'sean@pjsb.com');
update public.profiles set role = 'production'
 where lower(email) = 'sean@pjsb.com' and role = 'salesman';

insert into public.production_salesman_assignments (salesman_id, production_id)
select s.id, p.id
  from public.profiles s
  join public.profiles p on lower(p.email) = 'sean@pjsb.com' and p.role = 'production'
 where s.role = 'salesman'
   and lower(s.display_name) in ('rex', 'harriet', 'bong', 'joyce', 'onn', 'maggie', 'foo', 'fatt', 'lawrance')
on conflict (salesman_id) do update set production_id = excluded.production_id;

commit;
