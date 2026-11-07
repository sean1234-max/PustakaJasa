-- ReviewAgent reviews every order by itself (Sean, 2026-11-07): when an order comes in for review — and
-- again after the salesman edits it or Production uploads a Corrected Excel — it compares the website's
-- order with the teacher's kertas kerja (words, spelling, quantities, Jenis Plak) and checks which lines
-- should be red. An order with nothing found only gets 🟢 on the review list; one with questions gets
-- them asked in the salesman's own group (Sean + the bots + that salesman), and the salesman's reply is
-- kept on the order. It never changes an order and never presses Done Review.

-- One review per order: the latest. `version` says which state of the order it read (items + files), so a
-- changed order is reviewed again. Only the bots write it (secret key); Production / Admin can read it.
create table if not exists public.order_auto_reviews (
  order_id           text primary key references public.orders(id) on delete cascade,
  version            text not null,
  status             text not null check (status in ('running', 'done', 'skipped', 'failed')),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  compared_with      jsonb not null default '[]'::jsonb,   -- [{ path, name }] the teacher's files read
  summary            text,
  differences        jsonb not null default '[]'::jsonb,   -- compare_result differences (kertas kerja vs order)
  red_lines          jsonb not null default '[]'::jsonb,   -- reviewChecks.js red-line issues (B1 / R1 / C3)
  issue_count        integer not null default 0,
  note               text,                                 -- why skipped / failed
  report_chat_id     bigint,                               -- where the questions were asked
  report_message_id  bigint,
  answer             text,                                 -- the salesman's reply
  answered_by        text,
  answered_at        timestamptz
);
alter table public.order_auto_reviews enable row level security;
drop policy if exists "production reads auto reviews" on public.order_auto_reviews;
create policy "production reads auto reviews" on public.order_auto_reviews
  for select using (public.current_role() in ('production', 'admin'));

-- A salesman's own Telegram group: where ReviewAgent asks him about his orders. Set once by typing
-- "@PjsbReviewAgent link" in the group (the bot finds which linked salesman is in it).
create table if not exists public.salesman_groups (
  chat_id      bigint primary key,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  title        text,
  linked_at    timestamptz not null default now()
);
create index if not exists salesman_groups_profile on public.salesman_groups (profile_id);
alter table public.salesman_groups enable row level security;
