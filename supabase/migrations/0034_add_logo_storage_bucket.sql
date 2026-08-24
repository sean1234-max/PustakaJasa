-- School logos used to be stored as base64 data URLs directly in
-- orders.logo_data_url — every upload counted against the project's whole
-- 500 MB (Free plan) database quota, not the much larger 1 GB (Free) / 100
-- GB (Pro) storage quota meant for exactly this kind of file. Moving them
-- into a real Storage bucket instead: orders.logo_data_url now holds a
-- public Storage URL (the column/name is left as-is — an <img src> works
-- identically whether it's a data: URI or an https:// URL, and every
-- existing reader of this column needs no changes).
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Any authenticated account (teacher) can upload a logo — RLS on the
-- `orders` table itself is what actually scopes who can attach a given
-- logo URL to a given order; this bucket only needs to allow the upload.
create policy "authenticated users can upload logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'logos');

-- Logos aren't sensitive (a school's own crest/logo) and need to be
-- viewable by every role that can see an order (teacher, Sales,
-- Production, Admin) — public read on the bucket already covers this
-- without needing a signed URL per viewer.
create policy "anyone can read logos"
  on storage.objects for select
  using (bucket_id = 'logos');
