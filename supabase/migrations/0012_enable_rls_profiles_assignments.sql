-- 0010_scope_rls_by_role.sql added scoped policies to `profiles` and
-- `salesman_assignments`, but never turned RLS on for those two tables —
-- both predate any migration in this repo (created directly in the
-- Supabase dashboard), so it was unknown from the repo alone whether RLS
-- was already enabled on them. Confirmed via the Table Editor's red
-- "Unrestricted" badge that it was NOT: a policy has no effect at all
-- unless RLS is enabled on the table, so those two tables have been fully
-- open the entire time despite 0010's policies existing. This closes that.
alter table public.profiles enable row level security;
alter table public.salesman_assignments enable row level security;
