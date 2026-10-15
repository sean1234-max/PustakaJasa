-- Duplicate order check (Sean, 2026-10-15): before an order is submitted the
-- Cart asks for the school's orders that look like the same one — any still in
-- progress, or any order (old ones too) from the same Excel file or for the
-- same Function Date. Cancelled orders and Tambahan never count. The person
-- submitting can still go ahead (a second confirm); what they were shown and
-- who went ahead is kept on the new order (duplicate_check) for Production.
-- Every Excel's fingerprint (SHA-256) is kept in its import_files entry
-- ({ path, name, hash }), so no new column is needed for that.

alter table public.orders add column if not exists duplicate_check jsonb;

-- Security definer: a salesman or the school itself can't read every order of
-- the school (RLS), so this returns only what the warning shows.
create or replace function public.find_possible_duplicates(p_school_id uuid, p_function_date text, p_hashes text[])
returns table (id text, status text, created_at timestamptz, submitted_by text, function_date text, total_amount numeric, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  select * from (
    select o.id, o.status, o.created_at,
           case when o.created_by_salesman is not null then 'salesman ' || coalesce(o.sales, '')
                else 'teacher ' || coalesce(o.pic_name, '') end,
           o.function_date, o.total_amount,
           array_remove(array[
             case when o.status <> 'Completed' then 'in_progress' end,
             case when exists (select 1 from jsonb_array_elements(coalesce(o.import_files, '[]'::jsonb)) f
                               where f ->> 'hash' = any(coalesce(p_hashes, '{}'))) then 'same_file' end,
             case when p_function_date ~ '^\d{4}-\d\d-\d\d'
                       and left(o.function_date, 10) = left(p_function_date, 10) then 'same_function_date' end
           ], null) as reasons
      from public.orders o
     where o.created_by = p_school_id
       and o.status <> 'Cancelled'
       and o.parent_order_id is null
       and (auth.uid() = p_school_id or public.current_role() in ('salesman', 'production', 'store_admin', 'admin'))
  ) m
  where cardinality(m.reasons) > 0
  order by m.created_at desc
  limit 10;
$$;

revoke execute on function public.find_possible_duplicates(uuid, text, text[]) from public, anon;
grant execute on function public.find_possible_duplicates(uuid, text, text[]) to authenticated;
