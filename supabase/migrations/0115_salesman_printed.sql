-- Salesman's own "Printed" mark (Sean, 2026-11-06): a button on his Salesman Approved cards stamps when he
-- printed the order; pressing it again clears it. Only the Sales dashboard shows it. Separate from
-- printed_at (stamped by Print itself, shown on the printout).
alter table public.orders add column if not exists salesman_printed_at timestamptz;

do $$
declare d text; n text;
begin
  -- orders_write_guard: an approved order's salesman may set it, like printed_at
  d := pg_get_functiondef('public.orders_write_guard()'::regprocedure);
  if position('salesman_printed_at' in d) = 0 then
    n := replace(d, E'- ''printed_at'' - ''status''', E'- ''printed_at'' - ''salesman_printed_at'' - ''status''');
    if n = d then raise exception 'orders_write_guard: nothing replaced'; end if;
    execute n;
  end if;
end $$;
