-- ============================================================================
-- Live-schema reconciliation, from verify_live_schema.sql + the Supabase
-- security advisor (2026-08-31). 0039's own header warned the live project
-- had drifted from earlier policy-naming generations; this is the cleanup.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) SECURITY: `orders` had TWO INSERT policies. PostgreSQL ORs permissive
--    policies together, so an INSERT succeeded if EITHER passed.
--      "teacher creates own orders"  -> full 0039 checks: created_by = uid,
--         role = teacher, account active, status = 'Submitted to Sales',
--         a valid salesman_id.
--      "teachers insert own orders"  -> a pre-0010 leftover whose ONLY check
--         is created_by = auth.uid().
--    With both present a teacher could INSERT an order in ANY status
--    (e.g. straight to 'Completed'), bypassing the whole Sales/Production
--    workflow — the exact BUG-001 class 0017 was written to close. Drop it.
-- ---------------------------------------------------------------------------
drop policy if exists "teachers insert own orders" on public.orders;

-- ---------------------------------------------------------------------------
-- 2) Stale duplicate policies, each fully superseded by an identically- or
--    more-permissive current one (verify_live_schema.sql BLOCK 3). Not holes
--    on their own, but they make the `orders` policy set unreadable. The
--    canonical form is current_role()-based (0010's stated convention).
-- ---------------------------------------------------------------------------
drop policy if exists "teachers see own orders"     on public.orders;  -- == "teacher reads own orders"     (created_by = auth.uid())
drop policy if exists "production see all orders"    on public.orders;  -- == "production reads all orders"   (current_role() = 'production')
drop policy if exists "production update all orders" on public.orders;  -- == "production updates all orders" (current_role() = 'production')

-- ---------------------------------------------------------------------------
-- 3) Advisor 0011 (function_search_path_mutable): order_items_total_consistent
--    (added in 0041) was created without a fixed search_path. Recreate it
--    verbatim with `set search_path = public`, matching every other function
--    in this schema. The body is byte-for-byte unchanged from 0041.
-- ---------------------------------------------------------------------------
create or replace function public.order_items_total_consistent(p_items jsonb, p_total numeric)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_sum   numeric := 0;
  v_count int;
  v_qty   numeric;
  v_harga numeric;
  v_unit  numeric;
  v_jenis text;
  e       jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return false;
  end if;

  v_count := jsonb_array_length(p_items);
  if v_count > 2000 then
    return false;
  end if;

  for e in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_jenis := e ->> 'jenisPlak';
      v_qty   := (e ->> 'qty')::numeric;
      v_harga := (e ->> 'harga')::numeric;
      v_unit  := nullif(e ->> 'unitPrice', '')::numeric;
    exception when others then
      return false;
    end;

    if v_jenis is null or length(btrim(v_jenis)) = 0 then return false; end if;
    if v_qty is null or v_qty <= 0 or v_qty <> floor(v_qty) then return false; end if;
    if v_harga is null or v_harga < 0 then return false; end if;
    if abs(v_harga - coalesce(v_unit, 0) * v_qty) > 0.05 then return false; end if;

    v_sum := v_sum + v_harga;
  end loop;

  return abs(coalesce(p_total, 0) - v_sum) <= greatest(0.05, v_count * 0.01);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Advisors 0028/0029: SECURITY DEFINER functions exposed as
--    /rest/v1/rpc/<name>.
--
--    a) Trigger functions — never meant to be called directly. Revoking
--       EXECUTE from everyone does NOT stop the triggers firing (trigger
--       execution is not gated by the invoker's EXECUTE privilege); it only
--       removes the bogus RPC endpoint.
-- ---------------------------------------------------------------------------
revoke execute on function public.orders_write_guard()  from public, anon, authenticated;
revoke execute on function public.orders_amount_guard() from public, anon, authenticated;

--    b) RLS helper functions — an RLS policy expression is evaluated with the
--       querying role's own EXECUTE rights before the SECURITY DEFINER
--       switch, so `authenticated` must keep EXECUTE. `anon` never queries a
--       table whose policy calls these, so it doesn't need them.
revoke execute on function public.current_role()                       from public, anon;
revoke execute on function public.current_status()                     from public, anon;
revoke execute on function public.my_assigned_teacher_ids()            from public, anon;
revoke execute on function public.my_assigned_invoicing_salesman_ids() from public, anon;

grant execute on function public.current_role()                        to authenticated;
grant execute on function public.current_status()                      to authenticated;
grant execute on function public.my_assigned_invoicing_salesman_ids()  to authenticated;
-- my_assigned_teacher_ids() has been dead since 0039 dropped
-- salesman_assignments and the policy that used it — left in place
-- (harmless), just no longer reachable by anon/public.

-- ---------------------------------------------------------------------------
-- NOT changed here:
--   * order_number_counters "RLS enabled, no policy" (advisor 0008, INFO) is
--     deliberate — 0019 locked that table so the ONLY way to advance it is
--     the SECURITY DEFINER next_order_seq(). Acknowledge/ignore that lint in
--     the Supabase dashboard.
--   * "Leaked password protection disabled" (advisor) is an Auth project
--     setting, not schema — enable it under Dashboard -> Authentication.
-- ---------------------------------------------------------------------------
