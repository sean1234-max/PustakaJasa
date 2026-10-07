-- Production's Edit Order (saveProductionEdit) takes extra stock when a fix
-- raises a quantity, through plak_stock_deduct — whose role check only let
-- teachers (and salesmen, 0081) in, so Save failed with "Not allowed."
-- Same in-place patch as 0081: only the role check changes.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.plak_stock_deduct(jsonb)'::regprocedure);
  if position($q$not in ('teacher', 'salesman') then$q$ in d) = 0 then
    raise exception 'plak_stock_deduct role check not found — update this migration';
  end if;
  d := replace(d, $q$not in ('teacher', 'salesman') then$q$, $q$not in ('teacher', 'salesman', 'production') then$q$);
  execute d;
end $$;
