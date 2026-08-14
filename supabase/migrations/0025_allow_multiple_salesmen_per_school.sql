-- Business rule change: a school may now be assigned to more than one
-- salesman (0020 previously enforced strictly one-salesman-per-school),
-- and the teacher picks which assigned salesman an order goes to on the
-- New Order form. This replaces the single-scalar assignment model with a
-- proper many-to-many one.

-- Both policies below reference my_assigned_salesman_id() (0019/0022) and
-- must be dropped before that function can be replaced with a set-returning
-- version.
drop policy if exists "teacher reads assigned salesman profile" on public.profiles;
drop policy if exists "teacher creates own orders" on public.orders;

-- A school (teacher_id) could previously have at most one assignment row;
-- now it can have many, one per salesman. The new unique constraint still
-- prevents the same salesman being assigned to the same school twice.
alter table public.salesman_assignments drop constraint if exists salesman_assignments_teacher_id_unique;
alter table public.salesman_assignments add constraint salesman_assignments_teacher_salesman_unique unique (teacher_id, salesman_id);

drop function if exists public.my_assigned_salesman_id();

-- Resolves every salesman assigned to the calling teacher's school.
-- SECURITY DEFINER so the lookup bypasses RLS internally, and only ever
-- resolves auth.uid(), so a caller can never use it to learn about anyone
-- else's assignments.
create or replace function public.my_assigned_salesman_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select salesman_id from public.salesman_assignments where teacher_id = auth.uid();
$$;

grant execute on function public.my_assigned_salesman_ids() to authenticated;

-- A teacher can read the profile of any salesman assigned to their school
-- (to show the picker on the New Order form), not just a single one.
create policy "teacher reads assigned salesman profile" on public.profiles
  for select using (id in (select public.my_assigned_salesman_ids()));

-- A teacher-created order must carry one of the salesmen currently
-- assigned to their school — never null, and never a salesman not in that
-- set, even if a tampered client sends one.
create policy "teacher creates own orders" on public.orders
  for insert with check (
    created_by = auth.uid()
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Submitted to Sales'
    and salesman_id is not null
    and salesman_id in (select public.my_assigned_salesman_ids())
  );
