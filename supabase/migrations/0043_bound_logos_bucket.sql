-- ============================================================================
-- P2: the `logos` Storage bucket (0034) accepts an upload from any
-- authenticated account with no size or type limit — a teacher account
-- could push arbitrary large files into it and burn the project's Storage
-- quota. School logos are small images; cap the bucket accordingly.
--
-- These limits are enforced by Storage itself, server-side, independent of
-- the bucket's RLS policy — so the existing "authenticated users can upload
-- logos" policy (0034) is left as-is.
--
-- NOT addressed here: orphaned logo objects are never deleted when an order
-- is cancelled or a logo is replaced. That's a periodic manual cleanup
-- (list objects in `logos`, drop any whose URL isn't referenced by an
-- orders.logo_data_url) — automating it safely needs its own migration.
-- ----------------------------------------------------------------------------
update storage.buckets
set
  file_size_limit = 2097152,  -- 2 MiB
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml', 'image/gif']
where id = 'logos';
