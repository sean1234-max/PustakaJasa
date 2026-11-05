-- Production remark (Sean, 2026-11-05): a free note on each In Production card so Production can
-- keep track of what is done and what is still waiting. Production/admin only write it
-- (orders_write_guard lets those roles through); it is separate from the order's own `remark`.
alter table public.orders add column if not exists production_note text;
