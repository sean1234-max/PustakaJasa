-- Duplicate order check, narrowed (Sean, 2026-10-15): a possible duplicate is an order of the
-- same school, by the same teacher (PIC name, ignoring case and extra spaces) and for the same
-- Function Date. Being still in progress, or the same Excel file, no longer counts on its own.
-- Cancelled orders and Tambahan still never count. The old 3-argument version (0094) is dropped
-- once the website calls this one.
create or replace function public.find_possible_duplicates(p_school_id uuid, p_function_date text, p_hashes text[], p_pic_name text)
returns table (id text, status text, created_at timestamptz, submitted_by text, function_date text, total_amount numeric, reasons text[])
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.status, o.created_at,
         case when o.created_by_salesman is not null then 'salesman ' || coalesce(o.sales, '')
              else 'teacher ' || coalesce(o.pic_name, '') end,
         o.function_date, o.total_amount,
         array['same_teacher_function_date']
    from public.orders o
   where o.created_by = p_school_id
     and o.status <> 'Cancelled'
     and o.parent_order_id is null
     and p_function_date ~ '^\d{4}-\d\d-\d\d'
     and left(o.function_date, 10) = left(p_function_date, 10)
     and upper(regexp_replace(trim(coalesce(o.pic_name, '')), '\s+', ' ', 'g'))
         = upper(regexp_replace(trim(coalesce(p_pic_name, '')), '\s+', ' ', 'g'))
     and trim(coalesce(p_pic_name, '')) <> ''
     and (auth.uid() = p_school_id or public.current_role() in ('salesman', 'production', 'store_admin', 'admin'))
   order by o.created_at desc
   limit 10;
$$;

revoke execute on function public.find_possible_duplicates(uuid, text, text[], text) from public, anon;
grant execute on function public.find_possible_duplicates(uuid, text, text[], text) to authenticated;
