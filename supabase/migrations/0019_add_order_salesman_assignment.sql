-- Part of enforcing the School<->Salesman assignment business rule for the
-- New Order flow. Previously "Sales" on an order was free text picked from
-- a hardcoded roster (src/data/catalog.js SALES_NAMES) with zero relation
-- to the real salesman_assignments table the Admin Portal manages — any
-- teacher could type/pick any name, regardless of which salesman (if any)
-- their school was actually assigned to. This ties order creation to the
-- same assignment data Admin manages, and makes the database — not the
-- client — the source of truth for which salesman an order is allowed to
-- carry.

-- Snapshots the salesman assigned to the school at the moment the order was
-- created. Deliberately NOT recomputed from the current assignment on
-- read — reassigning a school to a different salesman later must not
-- silently rewrite which salesman gets credit for past orders. Nullable
-- because historical orders (placed before this column existed) have no
-- value to backfill to — their free-text `sales` name doesn't reliably
-- correspond to any real salesman profile.
alter table public.orders
  add column if not exists salesman_id uuid references public.profiles(id);

-- Resolves the calling teacher's own assigned salesman, if any. Mirrors
-- my_assigned_teacher_ids() (0010) / current_role() (0010) — SECURITY
-- DEFINER so the lookup bypasses RLS internally, and only ever resolves
-- auth.uid(), so a caller can never use it to learn about anyone else's
-- assignment. Safe to declare `returns uuid` (a single scalar) rather than
-- `setof uuid` because 0020 adds a unique constraint on teacher_id — a
-- teacher can only ever have zero or one assignment row.
create or replace function public.my_assigned_salesman_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select salesman_id from public.salesman_assignments where teacher_id = auth.uid();
$$;

grant execute on function public.my_assigned_salesman_id() to authenticated;

-- A teacher needs to read their own assignment row (to show which
-- salesman is assigned to their school before submitting an order) and
-- that salesman's profile (to show a name). Neither was previously
-- reachable by a teacher — salesman_assignments only allowed the salesman
-- themself or an admin to read (0010), and profiles only allowed reading
-- your own row or, as admin, everyone's (0010/0015).
create policy "teacher reads own assignment" on public.salesman_assignments
  for select using (teacher_id = auth.uid());

create policy "teacher reads assigned salesman profile" on public.profiles
  for select using (id = public.my_assigned_salesman_id());

-- The actual enforcement: replaces the 0017 version of this policy, adding
-- the salesman_id check. A teacher-created order must carry exactly the
-- salesman currently assigned to their school — never null (a school with
-- no assignment yet cannot have an order created for it at all) and never
-- any other salesman_id, even if a tampered client sends one.
drop policy if exists "teacher creates own orders" on public.orders;
create policy "teacher creates own orders" on public.orders
  for insert with check (
    created_by = auth.uid()
    and public.current_role() = 'teacher'
    and public.current_status() = 'active'
    and status = 'Submitted to Sales'
    and salesman_id is not null
    and salesman_id = public.my_assigned_salesman_id()
  );
