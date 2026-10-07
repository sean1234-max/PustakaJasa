-- 0081's "salesman creates order for a school" checked the school with a
-- subquery on profiles — run under the salesman's own RLS, which can't see
-- teacher profiles, so every salesman submit failed ("violates row-level
-- security"). The check now goes through a security-definer helper that
-- answers only "is this an active school account".
create or replace function public.is_active_school(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = p_id and role = 'teacher' and status = 'active');
$$;
revoke all on function public.is_active_school(uuid) from public, anon;
grant execute on function public.is_active_school(uuid) to authenticated;

drop policy "salesman creates order for a school" on public.orders;
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
    and public.is_active_school(created_by)
  );
