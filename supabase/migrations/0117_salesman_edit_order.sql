-- Salesman Edit Order (Sean, 2026-11-07): before Production's Done Review, the order's salesman can change the
-- whole order (Function Details, every category, a new order file). Nothing new is allowed by orders_write_guard
-- — a salesman may already write any column of a 'Reviewing Order' order; these two columns only record it:
--   salesman_edited_at    — last time the salesman saved such an edit ("Edited by salesman" on the cards)
--   previous_import_files — the order files ({ path, name, replacedAt }) a newer upload replaced, Production's
--                           Corrected Excel included: kept for reference, never read for the order again
alter table public.orders add column if not exists salesman_edited_at timestamptz;
alter table public.orders add column if not exists previous_import_files jsonb not null default '[]'::jsonb;
