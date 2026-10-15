-- The website calls the 4-argument find_possible_duplicates (0095) since 2026-10-15.
drop function if exists public.find_possible_duplicates(uuid, text, text[]);
