-- Typing right away, part 2 (Sean, 2026-10-17). RUN ONLY AFTER the website
-- version that approves straight to In Production is live: the old website
-- only lets Store Admin enter an Invoice Number on a 'Salesman Approved' order.
--
-- Every order still waiting as 'Salesman Approved' moves to In Production.
-- typed_at is left as it is (null), so each one lands in Production's Typing
-- card, and its KIV & ARTWORK part (if any) on that card, exactly as a newly
-- approved order would. invoice_id stays empty for Store Admin to fill in.
-- The status check constraint keeps 'Salesman Approved', so this is reversible
-- (the ids are listed by the first query below; save that result first).
begin;

-- Like 0077 / 0092: skip orders_write_guard and the stamp triggers for this
-- bulk move (no signed-in user during a migration).
set local session_replication_role = replica;

update public.orders
   set status = 'In Production'
 where status = 'Salesman Approved';

-- A split invoice keeps its own status in invoice_groups; move any slice still
-- marked 'Salesman Approved' too (normally none, slices are made at invoicing).
update public.orders o
   set invoice_groups = sub.new_groups
  from (
    select o2.id,
           jsonb_agg(
             case when (g ->> 'status') = 'Salesman Approved'
                  then g || jsonb_build_object('status', 'In Production')
                  else g end
             order by ord
           ) as new_groups
      from public.orders o2, jsonb_array_elements(o2.invoice_groups) with ordinality as t(g, ord)
     where jsonb_array_length(o2.invoice_groups) > 0
     group by o2.id
  ) sub
 where o.id = sub.id
   and sub.new_groups is distinct from o.invoice_groups;

set local session_replication_role = default;

commit;

-- Before running (read-only): the orders this will move. Save the result.
-- select id, typed_at, invoice_id from public.orders where status = 'Salesman Approved' order by id;
-- After running (read-only): should return 0.
-- select count(*) from public.orders where status = 'Salesman Approved';
