-- ============================================================================
-- Jenis Plak catalog refresh from "ANUGERAH MOCK UP 2026 / 2027" (pages 1-7).
--
-- The catalog (plak_catalog_nodes) is normally managed by Production through
-- the catalog admin UI (src/lib/catalogAdminApi.js). This one-off bulk update
-- for the 2026/2027 season is captured as a migration so it's reviewable and
-- reproducible: 12 new codes + 3 price changes. Everything else on pages 1-7
-- already matched and is left untouched; codes not on pages 1-7 (e.g.
-- DECO LIGHT) are also left alone — they may be on later pages.
--
-- Guarded with `where not exists` on (code, parent_id) so a replay is a no-op
-- (there's no unique constraint on `code`).
-- ----------------------------------------------------------------------------

-- 1) Price changes ----------------------------------------------------------
update public.plak_catalog_nodes set price = 22    where code = 'JZ 19821' and parent_id is null;
update public.plak_catalog_nodes set price = 5.50  where code = 'SM-13187' and parent_id is null;
update public.plak_catalog_nodes set price = 5.50  where code = 'SM-13230' and parent_id is null;

-- 2) New top-level codes (flat, matching the existing convention) -----------
insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select null, v.code, v.price, false, v.ord
from (values
  ('PKF 265',           10.00, 26),
  ('PKF 266',           10.00, 27),
  ('PKC 263',           12.00, 28),
  ('PKC 246',           12.00, 29),
  ('SHINING STICKER A', 17.00, 31),
  ('ALUMINIUM PLATE A', 25.00, 32),
  ('WOOD ENGRAVED A',   25.00, 33),
  ('18093 GOLD',         7.00, 34),
  ('AS 22C',            15.00, 35)
) as v(code, price, ord)
where not exists (
  select 1 from public.plak_catalog_nodes n where n.code = v.code and n.parent_id is null
);

-- 3) PK 261 — a group with A/B/C size variants (different price each), same
--    shape as the existing CPH / VB / SONGKET groups. -----------------------
insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select null, 'PK 261', 0, false, 30
where not exists (
  select 1 from public.plak_catalog_nodes n where n.code = 'PK 261' and n.parent_id is null
);

insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select g.id, v.code, v.price, false, v.ord
from public.plak_catalog_nodes g
cross join (values ('A', 10.00, 0), ('B', 9.00, 1), ('C', 8.00, 2)) as v(code, price, ord)
where g.code = 'PK 261' and g.parent_id is null
  and not exists (
    select 1 from public.plak_catalog_nodes c where c.parent_id = g.id and c.code = v.code
  );
