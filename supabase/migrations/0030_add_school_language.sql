-- Not every school is a national SK — SJKC (Chinese vernacular) schools need
-- the MP THP 1/2 matrix's subject/class-level labels engraved in Chinese
-- instead of Malay (see src/data/catalog.js). This is a fixed property of
-- the school itself (set by Admin, like address), not something a teacher
-- picks per order.
alter table public.profiles add column if not exists school_language text not null default 'SK';
alter table public.profiles add constraint profiles_school_language_check check (school_language in ('SK', 'SJKC'));

-- Snapshotted onto each order at submit time (same pattern as sekolah,
-- school_type, etc.) rather than looked up live from profiles — so if a
-- school's language setting is corrected later, already-submitted orders
-- keep rendering/exporting in the language they were actually placed in.
alter table public.orders add column if not exists school_language text;
alter table public.orders add constraint orders_school_language_check check (school_language is null or school_language in ('SK', 'SJKC'));
