-- Backs the new Admin Portal's account-status feature (Active/Inactive/
-- Suspended) — nothing in this app has ever tracked whether an account
-- should be allowed to log in; every account has just always worked.
-- `role` itself needs no schema change to support the new 'admin' value
-- since it was never constrained by a CHECK.
alter table public.profiles
  add column if not exists status text not null default 'active';

alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'inactive', 'suspended'));

-- The real email lives in Supabase's internal auth.users table, which the
-- client can never query directly (not exposed via PostgREST) — so without
-- a copy here, Admin's user list/search would have no email to show at
-- all. The admin-user-ops Edge Function writes this alongside auth.users
-- at account-creation time, since it already knows the email then.
alter table public.profiles
  add column if not exists email text;
