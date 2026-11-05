-- Kertas kerja (Sean, 2026-11-05): the teacher's own paper (docx / xlsx / pdf / photo …) uploaded
-- next to the FORM ANUGERAH on New Order and Add On, so Production can compare it with the website.
-- Stored in the private order-imports bucket like the Excel; the order keeps the list [{path, name}].
alter table public.orders
  add column if not exists kertas_kerja_files jsonb not null default '[]'::jsonb,
  add column if not exists pending_addon_kertas_kerja jsonb;   -- an add-on's, until it is approved

-- phone photos are bigger than 5 MB
update storage.buckets set file_size_limit = 20971520 where id = 'order-imports';

do $$
declare d text; n text;
begin
  -- orders_write_guard: an add-on's kertas kerja travels with the other pending_addon_* fields
  d := pg_get_functiondef('public.orders_write_guard()'::regprocedure);
  if position('pending_addon_kertas_kerja' in d) = 0 then
    n := replace(d, E'- ''pending_addon_shipment_date''', E'- ''pending_addon_shipment_date'' - ''pending_addon_kertas_kerja''');
    if n = d then raise exception 'orders_write_guard: nothing replaced'; end if;
    execute n;
  end if;

  -- approve_addon: the Tambahan order keeps the add-on's kertas kerja; the parent's is cleared
  d := pg_get_functiondef('public.approve_addon(text, jsonb, boolean)'::regprocedure);
  if position('pending_addon_kertas_kerja' in d) = 0 then
    n := replace(d, E'pending_addon_shipment_date = null\n',
                    E'pending_addon_shipment_date = null, pending_addon_kertas_kerja = null\n');
    -- in the insert (the write guard is update-only, so the salesman approving can't be stopped by it)
    n := replace(n, E'id, parent_order_id, invoice_id,', E'id, kertas_kerja_files, parent_order_id, invoice_id,');
    n := replace(n, E'v_id, v_parent.id, null,', E'v_id, coalesce(v_parent.pending_addon_kertas_kerja, ''[]''::jsonb), v_parent.id, null,');
    if (length(n) - length(replace(n, 'pending_addon_kertas_kerja', ''))) / length('pending_addon_kertas_kerja') <> 2 or position('id, kertas_kerja_files' in n) = 0 then
      raise exception 'approve_addon: not every change applied';
    end if;
    execute n;
  end if;
end $$;
