-- Backs two Production-only features:
--   1. Per-category "how to fill it in" reference sample images.
--   2. A fully editable Jenis Plak catalog — replaces the static
--      PLAK_CATALOG array with a tree in the database so Production can
--      add/remove codes, edit prices, and hide/unhide (e.g. out of stock)
--      live for every teacher, without a code deploy. Seeded below from
--      the catalog that was previously hardcoded in src/data/catalog.js.
-- Same permissive RLS shape as `orders` — the app gates who can reach
-- these screens client-side via RequireRole, not via RLS.

create table public.catalog_reference_images (
  slot_id text primary key,
  image_data_url text,
  updated_at timestamptz not null default now()
);

alter table public.catalog_reference_images enable row level security;
create policy "allow anon read" on public.catalog_reference_images for select using (true);
create policy "allow anon insert" on public.catalog_reference_images for insert with check (true);
create policy "allow anon update" on public.catalog_reference_images for update using (true) with check (true);
create policy "allow anon delete" on public.catalog_reference_images for delete using (true);

create table public.plak_catalog_nodes (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.plak_catalog_nodes(id) on delete cascade,
  code text not null,
  price numeric not null default 0,
  hidden boolean not null default false,
  sort_order integer not null default 0
);

create index plak_catalog_nodes_parent_id_idx on public.plak_catalog_nodes(parent_id);

alter table public.plak_catalog_nodes enable row level security;
create policy "allow anon read" on public.plak_catalog_nodes for select using (true);
create policy "allow anon insert" on public.plak_catalog_nodes for insert with check (true);
create policy "allow anon update" on public.plak_catalog_nodes for update using (true) with check (true);
create policy "allow anon delete" on public.plak_catalog_nodes for delete using (true);

-- One-time recursive seed from the old hardcoded catalog.
create or replace function pg_temp.import_plak_node(p_parent uuid, p_node jsonb, p_sort int) returns void as $func$
declare
  new_id uuid;
  child jsonb;
  i int := 0;
begin
  insert into public.plak_catalog_nodes (parent_id, code, price, sort_order)
  values (p_parent, p_node->>'code', coalesce((p_node->>'price')::numeric, 0), p_sort)
  returning id into new_id;

  if p_node ? 'children' then
    for child in select * from jsonb_array_elements(p_node->'children') loop
      perform pg_temp.import_plak_node(new_id, child, i);
      i := i + 1;
    end loop;
  end if;
end;
$func$ language plpgsql;

do $do$
declare
  full_catalog jsonb := '[{"code":"CRYSTAL","children":[{"code":"80-B","price":15,"children":[{"code":"DESIGN 1"},{"code":"DESIGN 2"},{"code":"DESIGN 3"}]},{"code":"R-100","price":19,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"10030","price":29,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"AK-7","price":39,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"00S","price":39,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"0011A","price":39,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"SA4","price":45,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"R-7","price":49,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"CA-15","price":59,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"PSA-3","price":59,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"CM-27","price":62,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"11-3","price":72,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"0171","price":82,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]},{"code":"XB-5A","price":89,"children":[{"code":"DESIGN A"},{"code":"DESIGN B"},{"code":"DESIGN C"}]}]},{"code":"CPH","children":[{"code":"A","price":7.5},{"code":"B","price":7.5},{"code":"C","price":7.5}]},{"code":"VB","children":[{"code":"A","price":65},{"code":"B","price":60},{"code":"C","price":50},{"code":"D","price":45}]},{"code":"SONGKET","children":[{"code":"A","price":75},{"code":"B","price":70},{"code":"C","price":65}]},{"code":"57166 A","price":85},{"code":"DECO LIGHT","price":20},{"code":"CRYSTAL MEDAL","price":15},{"code":"SOLID GOLD","children":[{"code":"4942","price":59},{"code":"4943","price":59}]},{"code":"FD 251","price":6.5},{"code":"18059","price":6},{"code":"SM-13187","price":6,"children":[{"code":"GOLD","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"SILVER","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"BRONZE","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]}]},{"code":"SM-13230","price":6,"children":[{"code":"GOLD","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"SILVER","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"BRONZE","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]}]},{"code":"EASTERN TROPHY","children":[{"code":"MP393","price":6,"children":[{"code":"GOLD","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"SILVER","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"BRONZE","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]}]},{"code":"MP399","price":6,"children":[{"code":"GOLD","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"SILVER","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]},{"code":"BRONZE","children":[{"code":"BASE A","price":6},{"code":"BASE B","price":5},{"code":"BASE C","price":4}]}]}]},{"code":"13228","price":16},{"code":"JZ 19821","price":19},{"code":"H25","price":19},{"code":"YK","children":[{"code":"628","price":25},{"code":"1370","price":33}]},{"code":"W038","children":[{"code":"A","price":33},{"code":"B","price":29},{"code":"C","price":27}]},{"code":"SR-116 A","price":34},{"code":"SL245#3","price":42},{"code":"SL243#3","price":45},{"code":"TSL232#3","price":45}]'::jsonb;
  node jsonb;
  i int := 0;
begin
  for node in select * from jsonb_array_elements(full_catalog) loop
    perform pg_temp.import_plak_node(null, node, i);
    i := i + 1;
  end loop;
end $do$;
