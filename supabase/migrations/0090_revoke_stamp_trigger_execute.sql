-- Trigger-only functions (0086, 0089) are not meant to be RPCs: take away
-- the default EXECUTE so the API doesn't list them (security advisor 0028/0029).
revoke execute on function public.orders_invoice_stamp() from public, anon, authenticated;
revoke execute on function public.orders_artwork_stamp() from public, anon, authenticated;
revoke execute on function public.orders_artwork_stamp_insert() from public, anon, authenticated;
