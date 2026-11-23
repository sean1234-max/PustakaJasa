-- Urgent Orders Sheet kept right by itself (Sean, 2026-11-23 check: ORD-0417 / ORD-0464 never written because
-- Google failed at invoice time, cancelled ORD-0240 / ORD-0381 still listed). sync-urgent-order-sheet's cron run
-- ({"action":"retry"}, every 10 minutes) writes a missing row / removes a cancelled one and records it here.

-- The only order write the secret key (the cron) may make: urgent_sheet_synced_at. orders_write_guard lets an
-- update through when this function set pj.system_write for its own transaction — added before the guard's
-- "account is not active" check, which the secret key (no user) would otherwise fail.
create or replace function public.set_urgent_sheet_synced(p_order_id text, p_synced boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform set_config('pj.system_write', '1', true);
  update public.orders
     set urgent_sheet_synced_at = case when p_synced then now() else null end
   where id = p_order_id;
  perform set_config('pj.system_write', '', true);
end;
$$;
revoke all on function public.set_urgent_sheet_synced(text, boolean) from public, anon, authenticated;
grant execute on function public.set_urgent_sheet_synced(text, boolean) to service_role;

-- orders_write_guard: the same function with that one early exit (patched in place, so the rest of it — last
-- changed in 0124 — stays exactly as it is)
do $patch$
declare
  d text := pg_get_functiondef('public.orders_write_guard'::regproc);
  anchor text := E'begin\n  if v_status is distinct from ''active'' then';
begin
  if position('pj.system_write' in d) > 0 then
    return;
  end if;
  if position(anchor in d) = 0 then
    raise exception 'orders_write_guard changed shape — patch it by hand';
  end if;
  d := replace(d, anchor,
    E'begin\n  -- set_urgent_sheet_synced (0128): the cron recording an urgent order''s Sheet row, nothing else\n'
    || E'  if current_setting(''pj.system_write'', true) = ''1'' then\n    return new;\n  end if;\n\n'
    || E'  if v_status is distinct from ''active'' then');
  execute d;
end
$patch$;

select cron.unschedule('urgent-sheet-retry') where exists (select 1 from cron.job where jobname = 'urgent-sheet-retry');
select cron.schedule(
  'urgent-sheet-retry',
  '5-59/10 * * * *',
  $$ select net.http_post(
       url := 'https://dlzkdkxbnbhgldsvbybt.supabase.co/functions/v1/sync-urgent-order-sheet',
       body := '{"action": "retry"}'::jsonb,
       headers := '{"Content-Type": "application/json"}'::jsonb,
       timeout_milliseconds := 150000
     ) $$
);
