-- Salesman sees the kertas kerja on his order page (Sean, 2026-11-05). A file the teacher uploaded is
-- in the teacher's folder, so the salesman may read an order-imports file that one of the orders he
-- can see (orders RLS applies inside the check) lists as its kertas kerja.
create policy "salesman read kertas kerja" on storage.objects for select to authenticated
using (
  bucket_id = 'order-imports'
  and public.current_role() = 'salesman'
  and exists (
    select 1 from public.orders o
    where o.kertas_kerja_files @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
       or o.pending_addon_kertas_kerja @> jsonb_build_array(jsonb_build_object('path', storage.objects.name))
  )
);
