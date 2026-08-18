-- Admin's "Add School" form had no way to record a delivery address —
-- nothing in this app has ever stored where a school physically is.
alter table public.profiles add column if not exists address text;
