-- Drops the "EASTERN TROPHY - " prefix Production had asked to keep on
-- these two already-flattened top-level codes (see 0008, which pulled
-- MP393/MP399 out from under the "EASTERN TROPHY" grouping but kept the
-- prefix in the code text itself) — Production now wants them shown as
-- plain "MP393" / "MP399".
--
-- Renaming (not re-parenting; these are already top-level since 0008) is
-- safe only because no submitted order currently references the prefixed
-- codes — confirm this before running, the same caveat 0008 documented:
-- an order's item is matched to the catalog by this exact code text, so
-- renaming a code already on a submitted order would silently blank that
-- order's price lookup for that line.
update public.plak_catalog_nodes set code = 'MP393' where code = 'EASTERN TROPHY - MP393' and parent_id is null;
update public.plak_catalog_nodes set code = 'MP399' where code = 'EASTERN TROPHY - MP399' and parent_id is null;
