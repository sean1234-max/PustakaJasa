-- Core business rule from the School<->Salesman assignment spec: a school
-- (represented by its teacher account — see profiles.sekolah) may belong
-- to at most one salesman at a time; a salesman may have many schools.
-- Nothing in the schema previously enforced the "at most one" side —
-- src/lib/adminApi.js's assignSalesman() was a bare insert, and the Admin
-- Salesman Detail page (src/pages/AdminSalesmanDetail.jsx) only filtered
-- its "available schools" dropdown against *that* salesman's own
-- assignment rows, not every salesman's — so a school already assigned to
-- Salesman A could still be picked and assigned to Salesman B, leaving two
-- active rows for the same teacher_id.
--
-- A unique constraint is the only enforcement that also closes the race
-- condition where two admins assign the same currently-unassigned school
-- to two different salesmen at nearly the same moment: Postgres serializes
-- the two inserts against this constraint, so the second one fails
-- outright instead of both succeeding.
--
-- Safety: if duplicate teacher_id rows already exist, adding the
-- constraint below would need to guess which row to keep, and this
-- migration deliberately never deletes or merges assignment data on its
-- own. The check below aborts the whole migration (nothing is altered) and
-- names the affected teacher_ids so an admin can resolve them by hand
-- first — decide, per school, which salesman should keep it, then use the
-- Admin Portal's existing "Unassign" action to remove the other row(s) —
-- before re-running this migration. See
-- supabase/verify_school_salesman_duplicates.sql to check for these
-- without attempting the migration.
do $$
declare
  dupes text;
begin
  select string_agg(format('teacher_id=%s (%s assignments)', teacher_id, cnt), '; ')
    into dupes
  from (
    select teacher_id, count(*) as cnt
    from public.salesman_assignments
    group by teacher_id
    having count(*) > 1
  ) d;

  if dupes is not null then
    raise exception
      'Cannot enforce one-salesman-per-school: duplicate assignments already exist for %. Resolve these in the Admin Portal (unassign the extra salesman(s) for each affected school) before re-running this migration.',
      dupes;
  end if;
end $$;

alter table public.salesman_assignments
  add constraint salesman_assignments_teacher_id_unique unique (teacher_id);
