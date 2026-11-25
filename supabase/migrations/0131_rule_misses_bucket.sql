-- Sean, 2026-11-25 (step 0 of "fewer AI reads"): the kertas kerja the form bot's rules couldn't read, so the AI
-- read them, kept for 60 days (telegram-bot/ruleMiss.ts deletes older day folders) so the most common layouts
-- can become rules. Private: only the bot (secret key) reads or writes it; no policies, so nobody else can.
insert into storage.buckets (id, name, public)
values ('rule-misses', 'rule-misses', false)
on conflict (id) do nothing;
