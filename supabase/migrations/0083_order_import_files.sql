-- Every Excel the teacher uploaded for an order ({ path, name } list). A
-- draft can import a second file before submitting; each cart item now
-- remembers its own file and the order keeps all of them (src/utils/
-- importFiles.js). import_file_path / import_file_name stay as the first
-- file, for older readers.
alter table public.orders
  add column import_files jsonb not null default '[]'::jsonb;
