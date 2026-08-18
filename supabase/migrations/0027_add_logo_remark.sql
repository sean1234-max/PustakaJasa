-- "Not SK" was renamed to "Others" on the New Order form, and Others now
-- requires a short remark specifying the logo (in addition to the existing
-- logo upload) — captured per-order like the other Function Details fields.
alter table public.orders add column if not exists logo_remark text;
