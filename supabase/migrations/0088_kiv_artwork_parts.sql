-- Sean, 2026-10-14: KIV & ARTWORK — an order's Reserved plaques (SHORT
-- SUPPLY) and crystals (CRYSTAL / …) are a part made alongside its ordinary
-- plaques. Each part has its own card: plaques Typing → In Production → Done,
-- the KIV & ARTWORK part KIV & ARTWORK → In Production → Done. The order moves
-- on to shipment only once both are done:
--   plak_done_at            — the plaque card's In Production Done, while the
--                             KIV & ARTWORK part is still being made
--   kiv_production_done_at  — the KIV & ARTWORK card's In Production Done
-- (kiv_done_at, 0087, is its KIV & ARTWORK-tab Done.)
alter table public.orders
  add column if not exists plak_done_at timestamptz,
  add column if not exists kiv_production_done_at timestamptz;

