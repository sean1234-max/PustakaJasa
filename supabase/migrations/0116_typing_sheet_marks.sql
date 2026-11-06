-- Done Typing → Form_Responses sheet (Sean, 2026-11-06): which sheet row each order was marked on
-- ("SEAN (NOV)" in column I), so an order is marked once and its mark can be cleared when the order
-- is cancelled. Written only by the mark-typing-sheet Edge Function (service key) — no policies.
create table if not exists public.typing_sheet_marks (
  order_id   text primary key references public.orders(id) on delete cascade,
  sheet_row  integer not null,
  value      text not null,
  marked_by  uuid,
  marked_at  timestamptz not null default now()
);
alter table public.typing_sheet_marks enable row level security;
