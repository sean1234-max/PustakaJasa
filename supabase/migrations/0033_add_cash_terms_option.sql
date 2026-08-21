-- New Order's Terms dropdown (src/pages/NewOrderStep1.jsx) is changing
-- from L/O + Cheque to L/O + Cash. 'Cheque' can't simply be dropped from
-- orders_terms_check (0024_add_ketua_panitia_and_terms.sql) — a handful of
-- real orders already have terms='Cheque' stored, and Postgres re-checks
-- every column's CHECK constraint on any UPDATE of the row, not just the
-- column being changed, so a narrower constraint would break the very
-- next status/invoice update on one of those existing orders. Adding
-- 'Cash' alongside the existing allowed values keeps them valid while
-- letting new orders pick the new option.
alter table public.orders drop constraint orders_terms_check;
alter table public.orders add constraint orders_terms_check check (terms is null or terms in ('L/O', 'Cheque', 'Cash'));
