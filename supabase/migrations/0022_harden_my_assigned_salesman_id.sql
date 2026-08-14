-- my_assigned_salesman_id() (0019) is a scalar SQL function:
--   select salesman_id from public.salesman_assignments where teacher_id = auth.uid();
-- A scalar subquery that matches more than one row doesn't just return an
-- arbitrary one — Postgres raises "more than one row returned by a
-- subquery used as an expression" and the whole statement fails. This
-- function is invoked by an RLS policy on `profiles` ("teacher reads
-- assigned salesman profile"), which Postgres evaluates for every
-- authenticated read of `profiles` — including the profile lookup every
-- login and every page-refresh session-restore does (see the
-- session-restore effect in src/state/AppState.jsx). If the currently
-- calling user ever has more than one row in `salesman_assignments` as a
-- teacher_id — the exact scenario 0020's unique constraint exists to
-- prevent — every profile read for that user starts failing outright,
-- which surfaces as an unexplained bounce back to the login screen on
-- refresh (the profile fetch throws, `role` never gets set, RequireRole
-- redirects).
--
-- 0020 should make this impossible going forward, but this function
-- shouldn't be one bad row away from breaking login for whoever it
-- happens to. Adding `limit 1` makes it structurally unable to throw for
-- this reason, independent of whether the uniqueness constraint holds.
create or replace function public.my_assigned_salesman_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select salesman_id from public.salesman_assignments where teacher_id = auth.uid() limit 1;
$$;
