-- ============================================================================
-- SELEMPANG (sash) — one shared Jenis Plak catalog node.
--
-- The website's new "Selempang" order category (src/data/catalog.js) records
-- ACARA / WARNA / KUANTITI rows. All four sash colours (BIRU/HIJAU/KUNING/
-- MERAH) draw from ONE stock pool and cost the same, so they are a SINGLE
-- catalog leaf here — code 'SELEMPANG', RM40 — not one node per colour. The
-- colour a teacher picks is recorded on the order line, never in the catalog.
--
-- Priced at RM40 to match SELEMPANG_UNIT_PRICE in catalog.js — the two must
-- agree or orders_amount_guard (migration 0041) rejects every selempang
-- order. stock_qty is left NULL ("tracking not enabled yet") for Production
-- to set from the catalog admin UI, same as any other new code.
--
-- hidden = true: SELEMPANG has its own "Selempang" order category, so it must
-- never appear in the anugerah Jenis Plak picker (filterHiddenPlakCatalog).
-- Stock deduction, standardUnitPrice and the SelempangBlock stock preview all
-- resolve it by code from the UNfiltered catalog, so hiding it costs nothing.
--
-- Idempotent: guarded on (code, parent_id) like migration 0049, so a replay
-- is a no-op (there is no unique constraint on `code`). The UPDATE covers a
-- prior run of this migration that inserted the row with hidden = false.
-- ----------------------------------------------------------------------------

insert into public.plak_catalog_nodes (parent_id, code, price, hidden, sort_order)
select null, 'SELEMPANG', 40, true, 900
where not exists (
  select 1 from public.plak_catalog_nodes n
  where n.code = 'SELEMPANG' and n.parent_id is null
);

update public.plak_catalog_nodes
set hidden = true
where code = 'SELEMPANG' and parent_id is null and hidden is distinct from true;
