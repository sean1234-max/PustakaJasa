-- Sean, 2026-10-13: KIV — plaques ordered with NAMA MURID "Reserved" (no
-- name yet) are made later, once the names come. An order with Reserved
-- plaques shows in Production's KIV tab (and stays in Typing with a DONE
-- badge after Done Typing) until Production clicks KIV Done, which stamps
-- this; only then does it carry on to In Production. Same idea as typed_at.
alter table public.orders add column if not exists kiv_done_at timestamptz;
