-- Run this in the Supabase SQL editor (as the project owner, or anything
-- else with a role that bypasses RLS) to check whether any school is
-- currently assigned to more than one salesman — RLS on
-- salesman_assignments/profiles otherwise limits what an ordinary
-- authenticated session can see, so this needs to run with elevated
-- access, not from the app itself.
--
-- Use this both BEFORE running
-- supabase/migrations/0020_enforce_school_salesman_uniqueness.sql (that
-- migration aborts on its own if duplicates exist, but this lets you see
-- and resolve them ahead of time instead of discovering it from a failed
-- migration) and any time after, as a standing health check. Empty result
-- = no duplicates.
select
  sa.teacher_id,
  p_teacher.sekolah as school_name,
  p_teacher.display_name as teacher_name,
  count(*) as assignment_count,
  array_agg(p_sales.display_name order by p_sales.display_name) as assigned_salesmen,
  array_agg(sa.salesman_id order by p_sales.display_name) as assigned_salesman_ids
from public.salesman_assignments sa
join public.profiles p_teacher on p_teacher.id = sa.teacher_id
join public.profiles p_sales on p_sales.id = sa.salesman_id
group by sa.teacher_id, p_teacher.sekolah, p_teacher.display_name
having count(*) > 1
order by school_name;
