-- Backs the printed-order "ADD ON / AMEND / UPDATED DETAILS" stamp
-- (src/utils/orderStamp.js) and Production's matching on-screen badge.
--
-- `original_total_qty` is a frozen snapshot of the order's total quantity
-- at the moment it was first submitted (see submitOrder in
-- src/state/AppState.jsx) — never touched again afterward, even by later
-- Amend saves, so it stays a stable baseline to compare the *current*
-- total quantity against. `amended` just records whether the teacher ever
-- used "Update Details" (Amend) on this order before Sales approved it —
-- Amend is only reachable pre-approval, so this can never be true at the
-- same time the order also carries an approved Add On (batch > 0 items),
-- which is why the stamp logic checks approved Add Ons first and only
-- falls back to the qty-comparison classification when `amended` is set.
alter table public.orders add column if not exists original_total_qty integer;
alter table public.orders add column if not exists amended boolean not null default false;
