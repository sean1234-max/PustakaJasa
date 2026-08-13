-- `profiles.role` already carried a CHECK constraint restricting it to
-- ('teacher', 'salesman', 'production') — invisible to this repo since the
-- `profiles` table itself predates any migration here (created directly in
-- the Supabase dashboard). Discovered when inserting the first admin
-- profile failed with "violates check constraint profiles_role_check".
-- Replaces it with the same set plus 'admin'.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('teacher', 'salesman', 'production', 'admin'));
