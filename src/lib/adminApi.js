import { supabase } from './supabaseClient';

// Everything here is only reachable by the 'admin' role — enforced by RLS
// (supabase/migrations/0015_extend_rls_for_admin.sql), not just by hiding
// these pages from the nav. Account creation and password resets can't be
// done with a plain table call (Supabase Auth users aren't rows a client
// can insert/update) — those two go through the admin-user-ops Edge
// Function instead, which is the only place the service_role key is used.

export async function fetchAllProfiles() {
  const { data, error } = await supabase.from('profiles').select('*');
  if (error) throw error;
  return data;
}

export async function updateProfile(id, patch) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', id);
  if (error) throw error;
}

export async function fetchSalesmanAssignments() {
  const { data, error } = await supabase.from('salesman_assignments').select('*');
  if (error) throw error;
  return data;
}

// A school may now be assigned to more than one salesman (see
// supabase/migrations/0025_allow_multiple_salesmen_per_school.sql) — this
// is a bare insert, so assigning the same salesman to the same school
// twice FAILS on the (teacher_id, salesman_id) unique constraint instead
// of silently creating a duplicate row.
export async function assignSalesman(salesmanId, teacherId) {
  const { error } = await supabase
    .from('salesman_assignments')
    .insert({ salesman_id: salesmanId, teacher_id: teacherId });
  if (error) {
    if (error.code === '23505') throw new Error('This school is already assigned to this salesman.');
    throw error;
  }
}

export async function unassignSalesman(salesmanId, teacherId) {
  const { error } = await supabase
    .from('salesman_assignments')
    .delete()
    .eq('salesman_id', salesmanId)
    .eq('teacher_id', teacherId);
  if (error) throw error;
}

// Calls the admin-user-ops Edge Function — the only path that can create a
// real Supabase Auth account for someone else. Throws with a plain-language
// message on failure (duplicate email, etc.) rather than a raw error.
async function invokeAdminUserOps(payload) {
  const { data, error } = await supabase.functions.invoke('admin-user-ops', { body: payload });
  if (error) {
    // supabase-js surfaces non-2xx responses as a generic FunctionsHttpError;
    // the actual { error: "..." } body the function sent is on error.context.
    let message = 'Something went wrong. Please try again.';
    try {
      const body = await error.context?.json?.();
      if (body?.error) message = body.error;
    } catch {
      // fall back to the generic message above
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function createAccount({ role, sekolah, address, schoolLanguage, displayName, email, password, assignedSalesmanId }) {
  const result = await invokeAdminUserOps({ action: 'create', role, sekolah, address, schoolLanguage, displayName, email, password });
  if (role === 'teacher' && assignedSalesmanId) {
    await assignSalesman(assignedSalesmanId, result.id);
  }
  return result;
}

export async function resetPassword(userId, newPassword) {
  await invokeAdminUserOps({ action: 'reset_password', userId, newPassword });
}

// Hard-deletes the account (profile row + Supabase Auth user), not a status
// change — see admin-user-ops for why this has to go through the Edge
// Function rather than a plain table delete. Fails with a clear message if
// the account has order/audit-log history on record, since that's a
// foreign-key violation server-side, not a silent no-op.
export async function deleteAccount(userId) {
  await invokeAdminUserOps({ action: 'delete', userId });
}

// `before`/`after` should be plain objects describing what changed — never
// pass a password value in either. Failures here are logged, not thrown:
// a broken audit trail shouldn't be able to block the admin action that
// already succeeded.
export async function logAdminAction({ action, targetTable, targetId, before, after }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from('audit_log').insert({
    admin_id: user?.id,
    action,
    target_table: targetTable ?? null,
    target_id: targetId ?? null,
    before: before ?? null,
    after: after ?? null,
  });
  if (error) console.error('Failed to write audit log entry:', error);
}

export async function fetchAuditLog() {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*, profiles!audit_log_admin_id_fkey(display_name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}
