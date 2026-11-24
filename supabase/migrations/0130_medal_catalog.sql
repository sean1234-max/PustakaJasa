-- Sean, 2026-11-25: the 2026 medals (ANUGERAH ORDER 2026/MERENTAS DESA MEDAL 2027.pdf) into the catalog —
-- seven hanging medals (HM-M-…) and two plastic ones (15062 / 15063), each GOLD / SILVER / BRONZE like
-- SM-13187. Prices are the leaflet's; the colours add nothing. Stock not tracked yet (null) — Production fills
-- it in on the Catalog page. Shown at once (Sean). Every one of them is made from E CUT 0 (SEAN.jsx's HM rule
-- and product_mapping.csv's 15062 / 15063 rows). Re-running adds nothing twice.

with medal(code, price, sort_order) as (values
  ('HM-M-0031', 4.50, 40), ('HM-M-4525', 4.50, 41), ('HM-M-0026', 3.90, 42),
  ('HM-M-7526', 5.00, 43), ('HM-M-6526', 5.00, 44), ('HM-M-5026', 5.00, 45), ('HM-M-6025', 5.00, 46),
  ('15062', 4.00, 47), ('15063', 4.00, 48)
)
insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select null, m.code, m.price, false, m.sort_order
from medal m
where not exists (select 1 from public.plak_catalog_nodes n where n.parent_id is null and n.code = m.code);

with colour(code, sort_order) as (values ('GOLD', 0), ('SILVER', 1), ('BRONZE', 2))
insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select p.id, c.code, 0, false, c.sort_order
from public.plak_catalog_nodes p
cross join colour c
where p.parent_id is null
  and p.code in ('HM-M-0031', 'HM-M-4525', 'HM-M-0026', 'HM-M-7526', 'HM-M-6526', 'HM-M-5026', 'HM-M-6025', '15062', '15063')
  and not exists (select 1 from public.plak_catalog_nodes n where n.parent_id = p.id and n.code = c.code);
