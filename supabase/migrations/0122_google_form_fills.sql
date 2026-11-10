-- The salesmen's Google Form ("2026/27 MASTER LIST PRODUCTION ORDER", Sean 2026-11-10) filled for orders a
-- salesman submits on the website (supabase/functions/fill-google-form), as ExcelFormAgent already does for the
-- bot's. One row per order, so it is never posted twice. Only the function (secret key) reads or writes it.
create table if not exists public.google_form_fills (
  order_id text primary key references public.orders(id) on delete cascade,
  status text not null,          -- filled / failed / no_sale / no_due_date / bot
  qty integer,
  filled_at timestamptz not null default now()
);
alter table public.google_form_fills enable row level security;
