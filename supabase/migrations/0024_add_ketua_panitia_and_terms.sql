-- Adds "Ketua Panitia" (the department head placing the order — a school
-- can have many panitia ordering independently from their own budgets, so
-- this is captured per-order rather than tied to the teacher account) and
-- "Terms" (payment method: L/O or Cheque) to the New Order form.
alter table public.orders add column if not exists ketua_panitia text;
alter table public.orders add column if not exists terms text;

alter table public.orders add constraint orders_terms_check check (terms is null or terms in ('L/O', 'Cheque'));
