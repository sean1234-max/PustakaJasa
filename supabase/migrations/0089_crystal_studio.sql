-- Sean, 2026-10-14 (crystal Stage 2): Crystal Studio's data moves into this
-- project, and orders record when their crystal artwork was confirmed.
--
-- Crystal Studio (copied from the colleague's repo into ours) keeps:
--   crystal_library   the crystal designs (templates), one JSON "item" each
--   crystal_designs   saved work; rows "order-<id>" hold one order's own
--                     crystals ("Save for this order only")
--   crystal_settings  master template, font list, school logos
--   storage "crystal" design pictures, imported .ai copies, font files
-- Unlike the colleague's test setup (anyone could write, no login), only
-- signed-in, active accounts can read, and only Production / Admin change the
-- library, settings and files. Teachers / salesmen may only save the crystals
-- of an order they can already see (orders RLS decides that).

create table if not exists public.crystal_library (
  id text primary key,
  item jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crystal_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.crystal_designs (
  id text primary key,
  meta jsonb not null,
  design jsonb not null,
  -- the order an "order-<id>" row belongs to; read from what the studio saves
  order_id text generated always as (design -> 'data' ->> 'order') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- an order's row must carry exactly that order's id (js/jenis.js
  -- orderDesignId), so nobody can put their crystals on another order
  constraint crystal_designs_order_row check (
    id not like 'order-%'
    or (order_id is not null
        and id = left('order-' || trim(both '-' from regexp_replace(lower(order_id), '[^a-z0-9]+', '-', 'g')), 40))
  )
);

revoke all on public.crystal_library, public.crystal_settings, public.crystal_designs from anon;
grant select, insert, update, delete on public.crystal_library, public.crystal_settings, public.crystal_designs to authenticated;

alter table public.crystal_library enable row level security;
alter table public.crystal_settings enable row level security;
alter table public.crystal_designs enable row level security;

-- library + settings: every active account reads (the order pages draw the
-- previews); Production / Admin change them
drop policy if exists "crystal_library read" on public.crystal_library;
create policy "crystal_library read" on public.crystal_library for select to authenticated
  using (public.current_status() = 'active');
drop policy if exists "crystal_library write" on public.crystal_library;
create policy "crystal_library write" on public.crystal_library for all to authenticated
  using (public.current_status() = 'active' and public.current_role() in ('production', 'admin'))
  with check (public.current_status() = 'active' and public.current_role() in ('production', 'admin'));

drop policy if exists "crystal_settings read" on public.crystal_settings;
create policy "crystal_settings read" on public.crystal_settings for select to authenticated
  using (public.current_status() = 'active');
drop policy if exists "crystal_settings write" on public.crystal_settings;
create policy "crystal_settings write" on public.crystal_settings for all to authenticated
  using (public.current_status() = 'active' and public.current_role() in ('production', 'admin'))
  with check (public.current_status() = 'active' and public.current_role() in ('production', 'admin'));

-- designs: Production / Admin everything; anyone else only the rows of an
-- order they can see
drop policy if exists "crystal_designs access" on public.crystal_designs;
create policy "crystal_designs access" on public.crystal_designs for all to authenticated
  using (public.current_status() = 'active' and (
    public.current_role() in ('production', 'admin')
    or (order_id is not null and exists (select 1 from public.orders o where o.id = crystal_designs.order_id))
  ))
  with check (public.current_status() = 'active' and (
    public.current_role() in ('production', 'admin')
    or (order_id is not null and exists (select 1 from public.orders o where o.id = crystal_designs.order_id))
  ));

-- files: pictures are public to read (shown on the order pages), 50 MB each;
-- listing (the font files) needs a login; only Production / Admin change them
insert into storage.buckets (id, name, public, file_size_limit)
values ('crystal', 'crystal', true, 52428800)
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "crystal files: list" on storage.objects;
create policy "crystal files: list" on storage.objects for select to authenticated
  using (bucket_id = 'crystal');
drop policy if exists "crystal files: add" on storage.objects;
create policy "crystal files: add" on storage.objects for insert to authenticated
  with check (bucket_id = 'crystal' and public.current_status() = 'active' and public.current_role() in ('production', 'admin'));
drop policy if exists "crystal files: change" on storage.objects;
create policy "crystal files: change" on storage.objects for update to authenticated
  using (bucket_id = 'crystal' and public.current_status() = 'active' and public.current_role() in ('production', 'admin'))
  with check (bucket_id = 'crystal' and public.current_status() = 'active' and public.current_role() in ('production', 'admin'));
drop policy if exists "crystal files: remove" on storage.objects;
create policy "crystal files: remove" on storage.objects for delete to authenticated
  using (bucket_id = 'crystal' and public.current_status() = 'active' and public.current_role() in ('production', 'admin'));

-- ---------------------------------------------------------------------------
-- Artwork confirmed (crystal generate waits for it). Set by the teacher's
-- "Save for this order only", the Yes at submit, or the salesman's Confirm
-- Artwork button. The client only sends artwork_confirmed_at; who and when
-- are stamped below, the first time only.
--
-- Existing orders count as confirmed (Sean, 2026-10-13): the column default
-- fills every current row without firing the update triggers (a backfill
-- UPDATE would hit orders_write_guard), then is dropped so new orders start
-- unconfirmed.
alter table public.orders add column if not exists artwork_confirmed_at timestamptz default now();
alter table public.orders alter column artwork_confirmed_at drop default;
alter table public.orders add column if not exists artwork_confirmed_by_name text default 'Existing order';
alter table public.orders alter column artwork_confirmed_by_name drop default;
alter table public.orders add column if not exists artwork_confirmed_by_role text;

create or replace function public.orders_artwork_stamp()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_role text;
begin
  if old.artwork_confirmed_at is null and new.artwork_confirmed_at is not null then
    select display_name, role into v_name, v_role from public.profiles where id = auth.uid();
    new.artwork_confirmed_at := now();
    new.artwork_confirmed_by_name := v_name;
    new.artwork_confirmed_by_role := v_role;
  else
    new.artwork_confirmed_at := old.artwork_confirmed_at;
    new.artwork_confirmed_by_name := old.artwork_confirmed_by_name;
    new.artwork_confirmed_by_role := old.artwork_confirmed_by_role;
  end if;
  return new;
end;
$function$;

-- named to fire after orders_write_guard_trigger (BEFORE triggers run in
-- name order), like orders_zz_invoice_stamp_trigger
drop trigger if exists orders_zz_artwork_stamp_trigger on public.orders;
create trigger orders_zz_artwork_stamp_trigger
  before update on public.orders
  for each row execute function public.orders_artwork_stamp();

-- New orders: the Yes at submit is stamped the same way on insert.
create or replace function public.orders_artwork_stamp_insert()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
  v_role text;
begin
  if new.artwork_confirmed_at is not null then
    select display_name, role into v_name, v_role from public.profiles where id = auth.uid();
    new.artwork_confirmed_at := now();
    new.artwork_confirmed_by_name := v_name;
    new.artwork_confirmed_by_role := v_role;
  else
    new.artwork_confirmed_by_name := null;
    new.artwork_confirmed_by_role := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_artwork_stamp_insert_trigger on public.orders;
create trigger orders_artwork_stamp_insert_trigger
  before insert on public.orders
  for each row execute function public.orders_artwork_stamp_insert();

-- orders_write_guard: teachers and salesmen may confirm the artwork of an
-- order that is already approved (only change: the three artwork columns
-- join the columns they may touch after approval).
create or replace function public.orders_write_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_role text := public.current_role();
  v_status text := public.current_status();
begin
  if v_status is distinct from 'active' then
    raise exception 'Your account is not active.';
  end if;

  if v_role in ('admin', 'production') then
    return new;
  end if;

  if old.status = 'Cancelled' then
    raise exception 'This order has been cancelled and can no longer be edited.';
  end if;

  if new.reviewed_at is distinct from old.reviewed_at and new.reviewed_at is not null then
    raise exception 'Only Production can mark an order as reviewed.';
  end if;

  if new.typed_at is distinct from old.typed_at then
    raise exception 'Only Production can mark typing as done.';
  end if;

  if new.pending_addon_status = 'reviewed' and old.pending_addon_status is distinct from 'reviewed' then
    raise exception 'Only Production can review an add-on.';
  end if;

  if old.status = 'Reviewing Order' and new.status = 'Reviewing Order'
     and old.reviewed_at is not null and new.reviewed_at is not null
     and (new.items is distinct from old.items or new.total_amount is distinct from old.total_amount) then
    raise exception 'This order was already reviewed — changing it sends it back to Production for review.';
  end if;

  if v_role = 'teacher' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled') then
      raise exception 'Teachers cannot change an order''s status.';
    end if;
    if old.status = 'Reviewing Order' then
      return new;
    end if;
    if old.status in ('Salesman Approved', 'In Production') then
      if (to_jsonb(new)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at' - 'artwork_confirmed_at' - 'artwork_confirmed_by_name' - 'artwork_confirmed_by_role')
         is distinct from
         (to_jsonb(old)
            - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
            - 'printed_at' - 'artwork_confirmed_at' - 'artwork_confirmed_by_name' - 'artwork_confirmed_by_role')
      then
        raise exception 'This order is already approved — submit an Add-On to change it.';
      end if;
      return new;
    end if;
    raise exception 'This order can no longer be edited.';
  end if;

  if v_role = 'salesman' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled')
       and not (old.status = 'Reviewing Order' and new.status = 'Salesman Approved' and old.reviewed_at is not null) then
      raise exception 'Salesmen can approve an order only after Production has reviewed it, or cancel it.';
    end if;
    if old.status = 'Reviewing Order' then
      return new;
    end if;
    if old.pending_addon_status in ('pending', 'reviewed') then
      if new.items is distinct from old.items and old.pending_addon_status is distinct from 'reviewed' then
        raise exception 'Production has to review this add-on before it can be approved.';
      end if;
      return new;
    end if;
    if (to_jsonb(new)
          - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
          - 'printed_at' - 'status' - 'artwork_confirmed_at' - 'artwork_confirmed_by_name' - 'artwork_confirmed_by_role')
       is distinct from
       (to_jsonb(old)
          - 'pending_addon_items' - 'pending_addon_status' - 'pending_addon_reject_reason'
          - 'printed_at' - 'status' - 'artwork_confirmed_at' - 'artwork_confirmed_by_name' - 'artwork_confirmed_by_role')
    then
      raise exception 'This order is already approved — changes go through an Add-On.';
    end if;
    return new;
  end if;

  if v_role = 'store_admin' then
    if new.status is distinct from old.status
       and not (old.status = 'Reviewing Order' and new.status = 'Cancelled')
       and not (old.status = 'Reviewing Order' and new.status = 'In Production' and old.reviewed_at is not null)
       and not (old.status = 'Salesman Approved' and new.status = 'In Production') then
      raise exception 'Store Admin can open the invoice of a Salesman Approved order, approve a reviewed order and open its invoice in one go, or cancel an order still being reviewed.';
    end if;
    if old.status <> 'Reviewing Order' and (
      new.items is distinct from old.items
      or new.total_amount is distinct from old.total_amount
      or new.price_adjusted is distinct from old.price_adjusted
      or new.shipment_date is distinct from old.shipment_date
      or new.function_date is distinct from old.function_date
      or new.salesman_delivery is distinct from old.salesman_delivery
    ) then
      raise exception 'Store Admin can only adjust pricing/dates while an order is still awaiting approval.';
    end if;
    if (to_jsonb(new) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at' - 'salesman_delivery')
       is distinct from
       (to_jsonb(old) - 'invoice_id' - 'invoice_groups' - 'items' - 'total_amount' - 'price_adjusted' - 'shipment_date' - 'function_date' - 'status'
                      - 'cancel_reason' - 'cancelled_at' - 'cancelled_by' - 'urgent' - 'urgent_sheet_synced_at' - 'salesman_delivery') then
      raise exception 'Store Admin can only set the Invoice Number (and pricing/approve/cancel if still awaiting approval).';
    end if;
    return new;
  end if;

  raise exception 'Not authorized to update this order.';
end;
$function$;
