-- Verification for 0045_ai_extraction_runs.sql + 0046_order_imports_bucket.sql.
-- Pure inspection — SELECT only, safe to paste into the SQL editor as-is.

-- ============================================================
-- BLOCK 1 — ai_extraction_runs columns. Expect these 16 rows (name / type):
--   id uuid, created_by uuid, file_name text, file_hash text,
--   storage_path text, status text, attempt smallint, model text,
--   prompt_tokens integer, completion_tokens integer,
--   cost_usd_cents numeric, raw_response jsonb, parsed_result jsonb,
--   error text, created_at timestamptz, completed_at timestamptz
-- ============================================================
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_extraction_runs'
order by ordinal_position;

-- ============================================================
-- BLOCK 2 — RLS must be ENABLED on the table. Expect relrowsecurity = true.
-- ============================================================
select relname, relrowsecurity
from pg_class
where oid = 'public.ai_extraction_runs'::regclass;

-- ============================================================
-- BLOCK 3 — policies on ai_extraction_runs. Expect exactly 2, both SELECT:
--   "read own extraction runs"        (created_by = auth.uid())
--   "admins read all extraction runs" (current_role() = 'admin')
-- NO insert / update / delete policy — the Edge Function writes via the
-- service role, an ordinary session must not be able to write at all.
-- ============================================================
select cmd, policyname, qual
from pg_policies
where schemaname = 'public' and tablename = 'ai_extraction_runs'
order by cmd, policyname;

-- ============================================================
-- BLOCK 4 — indexes on ai_extraction_runs. Expect 4:
--   ai_extraction_runs_pkey                          (id)
--   ai_extraction_runs_created_by_created_at_idx     (created_by, created_at DESC)
--   ai_extraction_runs_created_at_idx                (created_at)
--   ai_extraction_runs_file_hash_idx                 (file_hash) WHERE file_hash IS NOT NULL
-- ============================================================
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'ai_extraction_runs'
order by indexname;

-- ============================================================
-- BLOCK 5 — the order-imports bucket. Expect one row:
--   public = false,
--   file_size_limit = 5242880,
--   allowed_mime_types containing the xlsx + docx + octet-stream types.
-- ============================================================
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'order-imports';

-- ============================================================
-- BLOCK 6 — storage.objects policies scoped to this bucket. Expect 4,
-- one each of INSERT / SELECT / UPDATE / DELETE, all naming 'order-imports'
-- and (storage.foldername(name))[1] = auth.uid()::text :
--   "upload own order imports"  / "read own order imports"
--   "replace own order imports" / "delete own order imports"
-- ============================================================
select cmd, policyname, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like '%order imports%'
order by cmd, policyname;

-- ============================================================
-- BLOCK 7 — sanity: an ordinary caller cannot write the table. This just
-- confirms no INSERT/UPDATE/DELETE policy exists (count = 0).
-- ============================================================
select coalesce(count(*), 0) as writable_policy_count
from pg_policies
where schemaname = 'public' and tablename = 'ai_extraction_runs'
  and cmd in ('INSERT', 'UPDATE', 'DELETE');
