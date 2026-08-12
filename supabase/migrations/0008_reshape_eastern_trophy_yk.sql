-- Flattens two groups per Production's request:
--   EASTERN TROPHY (parent) -> MP393, MP399  becomes two standalone
--   top-level codes: "EASTERN TROPHY - MP393" and "EASTERN TROPHY - MP399",
--   each still expanding into GOLD/SILVER/BRONZE -> BASE A/B/C exactly as
--   before (only the top node's own code/parent changes, so everything
--   nested under MP393/MP399 stays attached to the same id and moves with
--   it — no need to recreate that subtree).
--
--   YK (parent) -> 628, 1370  becomes two standalone top-level codes
--   "628" and "1370" (no rename, just pulled out of the YK grouping).
--
-- Safe to run only because no submitted order currently references these
-- codes (confirmed before running) — renaming a code that's already on a
-- submitted order would blank that order's itemized price lookup for
-- that line, since it's matched by the old code text.

update public.plak_catalog_nodes
set parent_id = null,
    code = 'EASTERN TROPHY - MP393'
where code = 'MP393'
  and parent_id = (select id from public.plak_catalog_nodes where code = 'EASTERN TROPHY' and parent_id is null);

update public.plak_catalog_nodes
set parent_id = null,
    code = 'EASTERN TROPHY - MP399'
where code = 'MP399'
  and parent_id = (select id from public.plak_catalog_nodes where code = 'EASTERN TROPHY' and parent_id is null);

delete from public.plak_catalog_nodes
where code = 'EASTERN TROPHY' and parent_id is null;

update public.plak_catalog_nodes
set parent_id = null
where code in ('628', '1370')
  and parent_id = (select id from public.plak_catalog_nodes where code = 'YK' and parent_id is null);

delete from public.plak_catalog_nodes
where code = 'YK' and parent_id is null;
