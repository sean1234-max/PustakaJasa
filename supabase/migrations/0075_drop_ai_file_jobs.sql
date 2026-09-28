-- "Generate AI File" no longer queues a job server-side for a watcher on
-- another machine — it runs on the clicking computer through the local AI
-- File helper (scripts/ai-file-helper), so 0071's job queue table is unused.
drop table if exists public.ai_file_jobs;
