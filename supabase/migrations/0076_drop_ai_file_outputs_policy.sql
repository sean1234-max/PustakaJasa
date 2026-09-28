-- 0071's "ai-file-outputs" bucket held .ai files the old server-side job
-- queue uploaded; the new local AI File helper leaves output on the NAS, so
-- the bucket was emptied and deleted through the Storage API (Supabase
-- refuses direct SQL deletes on storage tables). This drops the read policy
-- that only ever applied to it.
drop policy if exists "staff read ai file outputs" on storage.objects;
