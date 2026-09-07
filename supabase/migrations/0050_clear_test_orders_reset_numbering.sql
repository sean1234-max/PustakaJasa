-- ============================================================================
-- Pre-launch reset. Wipes the 33 test orders and clears the order-number
-- counter so the first real order is ORD-0001.
--
-- The order id format changed at the same time (src/state/AppState.jsx's
-- submitOrder): the year is dropped — prefix 'ORD-', a single continuous
-- sequence from 1, zero-padded to 4 digits. next_order_seq('ORD-', 1)
-- seeds a fresh counter row on the first submission.
--
-- Nothing has a foreign key to public.orders, so a plain delete is safe.
-- Logo blobs in the `logos` storage bucket that these orders referenced are
-- left as harmless orphans (clear the bucket separately if wanted).
-- ----------------------------------------------------------------------------

delete from public.orders;
delete from public.order_number_counters where prefix like 'ORD%';
