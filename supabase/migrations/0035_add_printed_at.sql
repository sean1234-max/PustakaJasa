-- Records the actual moment a Teacher/Salesman print action happened (see
-- src/state/AppState.jsx's recordPrint) — order.date_placed/created_at are
-- both submission-time, not print-time, so "Order Printed" on a printout
-- needs its own column. Nullable (never printed yet); overwritten on every
-- re-print rather than kept as a history table — there's no prior
-- print-time data to lose, and every other timestamp on this table is a
-- single flat column, not a log.
alter table public.orders add column if not exists printed_at timestamptz;
