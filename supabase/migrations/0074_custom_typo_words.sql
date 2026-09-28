-- ============================================================================
-- Admin-managed additions to the built-in typo-check word list
-- (src/utils/typoCheck.js's TYPO_CHECK_DICTIONARY) — that list is curated in
-- code and only grows via a deploy; this table lets Admin add a "correct"
-- word from the Admin AI Usage page's Grammar Check Dictionary section
-- without one. Fetched once per login (AppState.jsx, same pattern as the
-- Jenis Plak catalog) and merged into the in-memory dictionary
-- (typoCheck.js's setCustomTypoWords) — every existing near-miss (edit
-- distance 1) hint on Reference Sample / Kuantiti Description fields then
-- also checks against these.
-- ----------------------------------------------------------------------------
create table public.custom_typo_words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Case-insensitive uniqueness — the dictionary itself is matched upper-cased
-- (typoCheck.js), so "Bahasa" and "BAHASA" would otherwise silently coexist
-- as two rows for the same word.
create unique index custom_typo_words_word_upper_idx on public.custom_typo_words (upper(word));

alter table public.custom_typo_words enable row level security;

-- Everyone signed in reads it — the typo hint applies while a teacher is
-- typing a New Order/Amend, not just on the Admin page. Only admin manages
-- the list.
create policy "authenticated reads custom typo words" on public.custom_typo_words
  for select using (auth.role() = 'authenticated');
create policy "admin writes custom typo words" on public.custom_typo_words
  for insert with check (public.current_role() = 'admin');
create policy "admin deletes custom typo words" on public.custom_typo_words
  for delete using (public.current_role() = 'admin');
