-- Review log (Sean, 2026-11-04 — step 5 of the AI review plan, docs/ai-review-rules.md): for every
-- order Production reviews, the order as submitted, the order at Done Review, and what AI Review
-- flagged. Comparing them shows what the AI missed and what it flagged for nothing; Sean writes the
-- reason in `note`, and the reason becomes a rule.
--
-- The two snapshots are taken by the database, whichever page saves the order (Edit Order, a
-- Corrected Excel, MERAH ticks …), so no save path can skip them:
--   original_items — the items just before the first change made while reviewing (or, when nothing
--                    was changed, the items at Done Review)
--   done_items     — the items the moment reviewed_at is set
-- ai_issues / note are written by the browser (AI Review box, the Review Log page).

create table if not exists public.review_log (
  order_id text primary key references public.orders(id) on delete cascade,
  original_items jsonb,
  original_at timestamptz,
  done_items jsonb,
  done_at timestamptz,
  done_by_name text,
  ai_issues jsonb,
  ai_at timestamptz,
  note text,
  note_at timestamptz
);

alter table public.review_log enable row level security;

drop policy if exists "production reads review log" on public.review_log;
create policy "production reads review log" on public.review_log
  for select using (public.current_role() in ('production', 'admin'));
drop policy if exists "production adds review log" on public.review_log;
create policy "production adds review log" on public.review_log
  for insert with check (public.current_role() in ('production', 'admin'));
drop policy if exists "production updates review log" on public.review_log;
create policy "production updates review log" on public.review_log
  for update using (public.current_role() in ('production', 'admin'));

create or replace function public.orders_review_log()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_name text;
begin
  -- first change while reviewing: keep the order as it was
  if old.status = 'Reviewing Order' and old.reviewed_at is null and old.items is distinct from new.items then
    insert into public.review_log (order_id, original_items, original_at)
    values (new.id, old.items, now())
    on conflict (order_id) do update
      set original_items = excluded.original_items, original_at = excluded.original_at
      where public.review_log.original_items is null;
  end if;
  -- Done Review
  if old.reviewed_at is null and new.reviewed_at is not null then
    select display_name into v_name from public.profiles where id = auth.uid();
    insert into public.review_log (order_id, original_items, original_at, done_items, done_at, done_by_name)
    values (new.id, new.items, now(), new.items, now(), v_name)
    on conflict (order_id) do update
      set done_items = excluded.done_items, done_at = excluded.done_at, done_by_name = excluded.done_by_name,
          original_items = coalesce(public.review_log.original_items, excluded.original_items),
          original_at = coalesce(public.review_log.original_at, excluded.original_at);
  end if;
  return null;
-- the log must never stop an order from saving
exception when others then
  raise warning 'review_log not written for %: %', new.id, sqlerrm;
  return null;
end;
$function$;

drop trigger if exists orders_review_log_trigger on public.orders;
create trigger orders_review_log_trigger
  after update on public.orders
  for each row execute function public.orders_review_log();
