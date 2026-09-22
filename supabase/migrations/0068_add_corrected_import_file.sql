-- Lets Production upload a CORRECTED copy of the FORM ANUGERAH file
-- (separate from import_file_path/import_file_name — the teacher's
-- original, kept as-is for reference) when they spot a qty/wording problem
-- against the original. Deliberately does NOT touch order.items,
-- total_amount, stock, or pricing — Production has no pricing/stock UI at
-- all today, and there is no stock give-back path anywhere in this app
-- (Amend's own qty edits don't touch stock either); this stays scoped to
-- "which file the CSV export reads from" only. Production/admin already
-- have unconditional orders UPDATE access (orders_write_guard) so no RLS
-- change is needed to let them set these columns.
alter table public.orders
  add column if not exists corrected_import_file_path text,
  add column if not exists corrected_import_file_name text,
  add column if not exists corrected_import_uploaded_at timestamptz;
