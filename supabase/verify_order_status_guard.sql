-- NOT a schema migration — a one-off verification script for BUG-001/BUG-002
-- fixes (0017/0018). Run each block separately in the SQL Editor. Nothing
-- here permanently changes data — the write-tests are wrapped in
-- begin/rollback, so even a "successful" illegal update would be undone.

-- ============================================================
-- STEP 1 — find a teacher and one of their own orders to test with.
-- Pick any row from the results for STEP 2.
-- ============================================================
select p.id as teacher_id, p.display_name, o.id as order_id, o.status
from public.profiles p
join public.orders o on o.created_by = p.id
where p.role = 'teacher'
order by o.id desc
limit 10;

-- ============================================================
-- STEP 2 — THIS SHOULD FAIL. Simulates that teacher trying to illegally
-- mark their own order "Completed" directly, skipping Sales/Production.
-- Replace <TEACHER_ID> and <ORDER_ID> with values from Step 1.
--
-- Expected result: an ERROR mentioning "Teachers cannot change an
-- order's status" (or "This order can no longer be edited" if that
-- order isn't in an editable stage). Seeing an error here is the GOOD
-- outcome — it means the fix is working. The transaction is rolled
-- back regardless, so nothing is actually changed either way.
-- ============================================================
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "<TEACHER_ID>", "role":"authenticated"}';
update public.orders set status = 'Completed' where id = '<ORDER_ID>';
rollback;

-- ============================================================
-- STEP 3 (optional) — confirms the legitimate Sales-approval flow still
-- works. Find a salesman and one of their assigned teachers' orders that
-- is still "Submitted to Sales".
-- ============================================================
select sa.salesman_id, p_s.display_name as salesman_name, o.id as order_id, o.status
from public.salesman_assignments sa
join public.profiles p_s on p_s.id = sa.salesman_id
join public.orders o on o.created_by = sa.teacher_id
where o.status = 'Submitted to Sales'
limit 10;

-- ============================================================
-- STEP 4 (optional) — THIS SHOULD SUCCEED (no error). Simulates that
-- salesman legitimately approving the order. Replace <SALESMAN_ID> and
-- <ORDER_ID> with values from Step 3. Still rolled back, so it won't
-- actually change the order's real status.
-- ============================================================
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub": "<SALESMAN_ID>", "role":"authenticated"}';
update public.orders set status = 'In Production' where id = '<ORDER_ID>';
rollback;
