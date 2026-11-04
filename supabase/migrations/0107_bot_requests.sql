-- Telegram bot requests (Sean, 2026-11-05; supabase/functions/telegram-bot). Two kinds:
--   change  — a salesman's message (Shipment Date, Function Date, Remark) read into proposed changes;
--             Production applies them on the order page (Apply / Dismiss), through the website's own
--             functions — the bot itself never changes an order.
--   compare — a file sent with an order number, compared with the order; the result kept here too.
-- Written by the bot (secret key); Production reads them and marks them applied / dismissed.

create table if not exists public.bot_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('change', 'compare')),
  order_id text references public.orders(id) on delete cascade,
  requested_by text,              -- the Telegram name of who asked
  source_text text,               -- the message the bot read
  changes jsonb,                  -- change: [{ field, from, to }]
  result jsonb,                   -- compare: the differences found
  status text not null default 'pending' check (status in ('pending', 'applied', 'dismissed', 'done')),
  handled_at timestamptz,
  handled_by_name text
);
create index if not exists bot_requests_order_pending on public.bot_requests (order_id) where status = 'pending';

alter table public.bot_requests enable row level security;
drop policy if exists "production reads bot requests" on public.bot_requests;
create policy "production reads bot requests" on public.bot_requests
  for select using (public.current_role() in ('production', 'admin'));
drop policy if exists "production handles bot requests" on public.bot_requests;
create policy "production handles bot requests" on public.bot_requests
  for update using (public.current_role() in ('production', 'admin'));
