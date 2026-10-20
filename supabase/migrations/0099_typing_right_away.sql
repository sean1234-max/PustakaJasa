-- Typing right away (Sean, 2026-10-17): when the salesman approves a reviewed
-- order it goes straight to In Production (Production's Typing card, since
-- typed_at is still null; its crystal / Reserved part shows on the KIV &
-- ARTWORK card as before). Store Admin keys in the AutoCount Invoice Number
-- later, alongside production; the store_admin branch already lets the
-- invoice be set on an In Production order without touching its status.
--
-- orders_write_guard was patched in place by 0097 / 0098, so (like those)
-- this edits the LIVE body by text replace instead of re-creating it, and
-- stops with an error if the line it expects isn't there.
--
-- The salesman may still move an order to 'Salesman Approved', so the website
-- that is live today keeps working until the new version is deployed. Safe to
-- run before the website change; run 0100 only after it.
begin;

do $$
declare
  d text;
  n text;
begin
  d := pg_get_functiondef('public.orders_write_guard'::regproc);
  if position('typing right away (0099)' in d) = 0 then
    n := replace(d,
      E'and not (old.status = ''Reviewing Order'' and new.status = ''Salesman Approved'' and old.reviewed_at is not null) then',
      E'-- typing right away (0099): approval may go straight to In Production\n'
      || E'       and not (old.status = ''Reviewing Order'' and new.status in (''Salesman Approved'', ''In Production'') and old.reviewed_at is not null) then');
    if n = d then
      raise exception 'orders_write_guard: the salesman approval rule was not found, nothing changed';
    end if;
    if (length(n) - length(replace(n, 'typing right away (0099)', ''))) / length('typing right away (0099)') <> 1 then
      raise exception 'orders_write_guard: the salesman approval rule matched more than once, nothing changed';
    end if;
    execute n;
  end if;
end $$;

commit;

-- Check (read-only): should return one row with true.
-- select position('typing right away (0099)' in pg_get_functiondef('public.orders_write_guard'::regproc)) > 0 as patched;
