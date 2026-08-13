-- NOT a schema migration — a one-off verification script. Run each block
-- separately in the SQL Editor (as the default "postgres" role) to check
-- (1) the teacher <-> salesman assignment data is set up correctly, and
-- (2) RLS actually restricts each role to what they should see.
-- Nothing here is destructive; safe to run repeatedly.

-- ============================================================
-- STEP 1 — see your 4 test accounts and their auth ids (UUIDs).
-- Use this to identify which id is teacher1 / teacher2 / salesman001 /
-- salesman002 by their display_name.
-- ============================================================
select id, role, sekolah, display_name
from public.profiles
order by role, display_name;

-- ============================================================
-- STEP 2 — confirm the assignment mapping itself: which salesman is
-- linked to which teacher. This should show exactly:
--   salesman001 -> teacher1
--   salesman002 -> teacher2
-- If a row is missing, or teacher1 is linked to salesman002 instead,
-- that's the actual bug to fix (in the salesman_assignments table data,
-- not in the RLS policies).
-- ============================================================
select
  sa.salesman_id,
  p_sales.display_name as salesman_name,
  sa.teacher_id,
  p_teach.display_name as teacher_name
from public.salesman_assignments sa
join public.profiles p_sales on p_sales.id = sa.salesman_id
join public.profiles p_teach on p_teach.id = sa.teacher_id
order by salesman_name;

-- ============================================================
-- STEP 3 — simulate teacher1's own session and see exactly what orders
-- table rows they'd get back under RLS. Replace <TEACHER1_UUID> with the
-- id you found for teacher1 in Step 1, then run these 3 lines together.
-- Expect: only orders where created_by = <TEACHER1_UUID>.
-- ============================================================
set local role authenticated;
set local request.jwt.claims = '{"sub": "<TEACHER1_UUID>", "role":"authenticated"}';
select id, sekolah, created_by, status from public.orders;
reset role;

-- ============================================================
-- STEP 4 — simulate salesman001's session. Replace <SALESMAN001_UUID>.
-- Expect: only orders whose created_by is one of salesman001's assigned
-- teachers (per Step 2) — should include teacher1's orders, and should
-- NOT include teacher2's orders (since teacher2 belongs to salesman002).
-- ============================================================
set local role authenticated;
set local request.jwt.claims = '{"sub": "<SALESMAN001_UUID>", "role":"authenticated"}';
select id, sekolah, created_by, status from public.orders;
reset role;

-- ============================================================
-- STEP 5 (optional) — repeat Step 3/4 with teacher2's and salesman002's
-- ids to confirm the same isolation holds for the other pair.
-- ============================================================
