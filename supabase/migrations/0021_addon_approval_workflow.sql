-- Add-On items (src/pages/AddOn.jsx / AddOnSummary.jsx) previously merged
-- straight into `orders.items`/`total_amount` the moment a teacher
-- submitted them (see the old commitAddOn in src/state/AppState.jsx) — no
-- Sales review at all, unlike the original order which must go through
-- SalesOrderSummary's Approve step (where price-per-unit can be
-- adjusted) before it counts. This gave Sales no chance to correct
-- pricing on add-on items, and merged them into `items` with no marker of
-- which batch (original vs a specific add-on round) each item belongs to.
--
-- This adds a holding area for a submitted-but-not-yet-approved add-on,
-- separate from the order's real items/total — those stay untouched until
-- Sales approves. `pending_addon_status` is null whenever there's no
-- add-on in flight; 'pending' while awaiting Sales, 'rejected' if Sales
-- sends it back (with an optional reason) for the teacher to cancel or
-- replace with a fresh submission.
--
-- No RLS policy changes needed: the existing "teacher updates own orders"
-- / "salesman updates assigned orders" policies (0010) and the
-- orders_write_guard trigger (0017) only ever gate the `status` column's
-- transitions, not which other columns a permitted update may touch — so
-- both roles can already write these new columns within their existing
-- edit windows.
alter table public.orders
  add column if not exists pending_addon_items jsonb,
  add column if not exists pending_addon_status text,
  add column if not exists pending_addon_reject_reason text;

alter table public.orders
  add constraint orders_pending_addon_status_check
  check (pending_addon_status is null or pending_addon_status in ('pending', 'rejected'));
