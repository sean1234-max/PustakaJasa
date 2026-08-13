-- The order id (ORD-2026-097 style) used to be assigned client-side by
-- reading the current max id then incrementing it (src/state/AppState.jsx
-- submitOrder) — a classic read-then-write race: two teachers submitting
-- within the same moment could both compute the same next number, and the
-- second insert would fail on the `orders.id` primary key with no
-- automatic retry, leaving that teacher's order stuck until they manually
-- resubmitted. This moves next-number assignment into a single atomic
-- database statement, so concurrent callers can never receive the same
-- number no matter how many submit at once.

create table public.order_number_counters (
  prefix text primary key,
  next_seq integer not null
);

alter table public.order_number_counters enable row level security;
-- Deliberately no "allow anon" policies here, unlike the rest of this
-- app's tables — this one must NOT be reachable directly via the anon
-- key, or the app could read-then-write it from the client and
-- reintroduce the exact race this migration fixes. The only way to
-- advance it is the atomic next_order_seq() function below, which is
-- SECURITY DEFINER so it can bypass RLS on this table specifically.

-- Seed the current year's counter from whatever's already in `orders`, so
-- this migration is safe to run without colliding with existing numbers.
do $$
declare
  v_prefix text := 'ORD-' || extract(year from now())::text || '-';
  v_max integer;
begin
  select max(substring(id from length(v_prefix) + 1)::int)
    into v_max
  from public.orders
  where id like v_prefix || '%';

  insert into public.order_number_counters (prefix, next_seq)
  values (v_prefix, coalesce(v_max, 96) + 1)
  on conflict (prefix) do nothing;
end $$;

-- Atomically returns the next sequence number for a prefix (e.g.
-- "ORD-2026-"), creating the counter row on first use. The UPDATE takes a
-- row-level lock on that prefix's counter row, so concurrent calls
-- serialize instead of racing — each caller gets a distinct number. The
-- insert-with-retry handles the (rare) case of two sessions both hitting
-- an unseeded prefix for the first time simultaneously.
create or replace function public.next_order_seq(p_prefix text, p_min_seq integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  loop
    update public.order_number_counters
      set next_seq = next_seq + 1
      where prefix = p_prefix
      returning next_seq - 1 into v_seq;
    exit when found;

    begin
      insert into public.order_number_counters (prefix, next_seq)
        values (p_prefix, p_min_seq + 1);
      v_seq := p_min_seq;
      exit;
    exception when unique_violation then
      -- Another concurrent call seeded the row first — loop back and UPDATE it.
    end;
  end loop;
  return v_seq;
end;
$$;

grant execute on function public.next_order_seq(text, integer) to anon, authenticated;
