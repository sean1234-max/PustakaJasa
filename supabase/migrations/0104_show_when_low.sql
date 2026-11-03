-- Production can show a low-stock auto-hidden code again (Sean, 2026-11-03): PK 261 / A sat at
-- 19.7% of its Stock, so the ≤20% auto-hide (catalog.js filterHiddenPlakCatalog) kept USJ 20
-- from ordering 3 more. show_when_low = Production pressed Unhide on it; Hide turns it off again.
-- Stock is still checked and deducted as usual (the red-zone reserve still applies).
alter table public.plak_catalog_nodes
  add column if not exists show_when_low boolean not null default false;
