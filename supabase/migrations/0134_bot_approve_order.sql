-- Approve from Telegram (Sean, 2026-11-27): ReviewAgent's "reviewed — please approve" reminder in a salesman's
-- own group carries ✅ Approve → the Shipment Date asked (CONFIRM / NOT CONFIRM, as the website asks) → this.
-- It approves the order exactly as it stands (no price / date / remark changes — those stay on the website).
--
-- The bot (secret key) acts as that salesman for this transaction (request.jwt.claims, as bot_submit_order 0118
-- does), so orders_write_guard and approve_tambahan check him like any website approval.
--   original → Salesman Approved, urgent worked out from its Shipment Date (the website's isUrgentShipment)
--   Tambahan → approve_tambahan (In Production); an urgent one's Sheet row is left to the 10-minute cron (0128)
--              — the website writes it from the page, the bot can't

create table if not exists public.bot_approvals (
  order_id         text primary key references public.orders(id) on delete cascade,
  salesman_id      uuid not null references public.profiles(id) on delete cascade,
  chat_id          bigint not null,
  gform_message_id bigint,            -- the "Google Form school name" question, answered by a reply
  approved_at      timestamptz,
  created_at       timestamptz not null default now()
);
alter table public.bot_approvals enable row level security;
-- no policies: only the bot (secret key) reads and writes it

create or replace function public.bot_approve_order(p_order_id text, p_salesman uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v public.orders;
  v_urgent boolean;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_salesman, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_salesman::text, true);
  select * into v from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found.';
  end if;
  if v.salesman_id is distinct from p_salesman then
    raise exception 'This is not your order.';
  end if;
  if v.cancelled_at is not null or v.status is distinct from 'Reviewing Order' or v.reviewed_at is null then
    raise exception 'This order is not waiting for your approval (now: %).', v.status;
  end if;
  if coalesce(v.shipment_date, '') !~ '^\d{4}-\d\d-\d\d' then
    raise exception 'This order has no Shipment Date yet — approve it on the website.';
  end if;

  if v.parent_order_id is not null then
    perform public.approve_tambahan(p_order_id, v.items, v.price_adjusted, '{}'::jsonb);
    -- approve_tambahan stamps an urgent one's Sheet row as written (the page writes it right after); here the
    -- cron writes it instead
    if (select urgent from public.orders where id = p_order_id) then
      perform set_config('pj.system_write', '1', true);
      update public.orders set urgent_sheet_synced_at = null where id = p_order_id;
      perform set_config('pj.system_write', '', true);
    end if;
    return 'In Production';
  end if;

  v_urgent := left(v.shipment_date, 10)::date - (now() at time zone 'Asia/Kuala_Lumpur')::date < 7;
  update public.orders set status = 'Salesman Approved', urgent = v_urgent where id = p_order_id;
  return 'Salesman Approved';
end;
$$;
revoke all on function public.bot_approve_order(text, uuid) from public, anon, authenticated;
grant execute on function public.bot_approve_order(text, uuid) to service_role;
