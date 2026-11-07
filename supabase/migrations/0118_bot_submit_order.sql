-- ExcelFormAgent submits a salesman's order itself (Sean, 2026-11-07): the salesman sends the Function
-- Details list and the FORM ANUGERAH (+ the teacher's kertas kerja), the bot asks what it needs to, shows a
-- summary with a Submit button, and on Submit the order goes in exactly as the website's New Order makes it.
--
-- bot_submit_order: the bot runs with the secret key, but the order number (next_order_seq), the stock
-- (plak_stock_deduct) and the crystal-artwork stamp all check *who* is asking. So inside this one
-- transaction the bot acts as that salesman (request.jwt.claims → auth.uid()), and every one of those checks
-- and triggers sees him — the same as his own New Order. Only the secret key (service_role) may call it.
create or replace function public.bot_submit_order(p_salesman uuid, p_order jsonb, p_stock jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_role text;
  v_status text;
  v_seq integer;
  v_id text;
  v_cols text;
  v_row jsonb;
begin
  select role, status into v_role, v_status from public.profiles where id = p_salesman;
  if v_role is distinct from 'salesman' or v_status is distinct from 'active' then
    raise exception 'Not an active salesman account.';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', p_salesman, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_salesman::text, true);

  v_seq := public.next_order_seq('ORD-', 1);
  v_id := 'ORD-' || lpad(v_seq::text, 4, '0');
  if jsonb_array_length(coalesce(p_stock, '[]'::jsonb)) > 0 then
    perform public.plak_stock_deduct(p_stock);
  end if;

  -- only the columns the bot sends (the rest keep their defaults: created_at, ...)
  v_row := p_order || jsonb_build_object('id', v_id);
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'orders' and v_row ? c.column_name;
  execute format('insert into public.orders (%1$s) select %1$s from jsonb_populate_record(null::public.orders, $1)', v_cols)
    using v_row;
  return v_id;
end;
$function$;

revoke execute on function public.bot_submit_order(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.bot_submit_order(uuid, jsonb, jsonb) to service_role;

-- One order being put together in a chat: what the salesman has given so far and what he has answered.
-- state: open → submitted (order_id) / cancelled. Only the bot (secret key) reads or writes these.
create table if not exists public.bot_order_sessions (
  id                 uuid primary key default gen_random_uuid(),
  chat_id            bigint not null,
  telegram_user_id   bigint not null,
  profile_id         uuid not null references public.profiles(id) on delete cascade,
  state              text not null default 'open' check (state in ('open', 'submitted', 'cancelled')),
  details            jsonb not null default '{}'::jsonb,   -- the Function Details list (orderDraft.ts) + answers
  school             jsonb,                                -- { id, sekolah, schoolLanguage } once it's one school
  excel              jsonb,                                -- { fileId, name } the FORM ANUGERAH
  kertas_kerja       jsonb not null default '[]'::jsonb,   -- [{ fileId, name }]
  kertas_asked       boolean not null default false,
  media_group_id     text,                                 -- files sent together with the list
  answers            jsonb not null default '{}'::jsonb,   -- question id → option key
  subs               jsonb not null default '[]'::jsonb,   -- the salesman's fixes to the file (botOrder.js substitute)
  ok_words           jsonb not null default '[]'::jsonb,   -- spelling the salesman said is right
  pending            jsonb,                                -- the question waiting for his answer
  order_id           text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists bot_order_sessions_chat on public.bot_order_sessions (chat_id, telegram_user_id, state);
alter table public.bot_order_sessions enable row level security;

-- A FORM ANUGERAH the bot filled from a kertas kerja: replying to it with the list submits that form, and the
-- kertas kerja it came from goes on the order too (no need to send it again).
create table if not exists public.bot_form_sources (
  chat_id      bigint not null,
  message_id   bigint not null,     -- the bot's message carrying the filled form
  file_id      text not null,       -- the kertas kerja's Telegram file
  file_name    text not null,
  created_at   timestamptz not null default now(),
  primary key (chat_id, message_id)
);
alter table public.bot_form_sources enable row level security;

-- Files a salesman sent together (a Telegram album): they arrive one message each, the list only on one.
create table if not exists public.bot_media_files (
  chat_id         bigint not null,
  message_id      bigint not null,
  media_group_id  text not null,
  file_id         text not null,
  file_name       text not null,
  with_list       boolean not null default false,   -- this one carried the Function Details list
  created_at      timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists bot_media_files_group on public.bot_media_files (chat_id, media_group_id);
alter table public.bot_media_files enable row level security;
