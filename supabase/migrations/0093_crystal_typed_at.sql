-- Sean, 2026-10-15: crystals whose artwork is confirmed go with the plaques —
-- same Typing card, one Generate AI. Done Typing stamps this as well when the
-- crystals were typed with the plaques; without it they stay their own
-- KIV & ARTWORK card (kiv_done_at / kiv_production_done_at), as before.
alter table public.orders add column if not exists crystal_typed_at timestamptz;
