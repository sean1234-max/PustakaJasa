-- Verification for 0043_bound_logos_bucket.sql.
-- Expect one row: id='logos', file_size_limit=2097152, and an
-- allowed_mime_types array of image/* types.
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'logos';
