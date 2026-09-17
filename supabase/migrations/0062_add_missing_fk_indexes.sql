-- Performance advisor (2026-09-17 pass): these foreign keys had no covering
-- index, so any query filtering/joining on them (RLS policies included —
-- e.g. "salesman reads own orders" filters orders by salesman_id) has to
-- scan the whole table instead of using an index. Purely additive — no
-- behavior change, just faster lookups as these tables grow.
create index if not exists audit_log_admin_id_idx on public.audit_log(admin_id);
create index if not exists orders_cancelled_by_idx on public.orders(cancelled_by);
create index if not exists orders_created_by_idx on public.orders(created_by);
create index if not exists orders_salesman_id_idx on public.orders(salesman_id);
