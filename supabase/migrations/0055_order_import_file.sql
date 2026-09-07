-- ============================================================================
-- Keep the teacher's uploaded FORM ANUGERAH file as a backup on the order,
-- so Production / Store Admin / Admin can download it and cross-check the
-- order details against the original spreadsheet.
--
-- The file goes into the existing private `order-imports` bucket (0046) at
-- import time; its path + original name are stamped on the order at submit.
-- ----------------------------------------------------------------------------
alter table public.orders
  add column if not exists import_file_path text,
  add column if not exists import_file_name text;

-- The uid-folder policies (0046) only let the uploading teacher read their
-- own files. Staff who review orders need to read any of them — they only
-- ever learn a path from an order they can already see (orders RLS).
create policy "staff read order imports" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'order-imports'
    and public.current_role() in ('production', 'store_admin', 'admin')
  );
