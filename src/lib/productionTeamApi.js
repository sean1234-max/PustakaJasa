import { supabase } from './supabaseClient';

// The production manager's Team page (supabase/migrations/0080): which
// production account works which salesman's orders. RLS lets only the
// manager (or Admin) change it; new accounts go through admin-user-ops.

export async function fetchProductionAccounts() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, email, status, is_production_manager')
    .eq('role', 'production');
  if (error) throw error;
  return data;
}

export async function fetchProductionAssignments() {
  const { data, error } = await supabase.from('production_salesman_assignments').select('salesman_id, production_id');
  if (error) throw error;
  return data;
}

// productionId null = nobody (only the manager sees that salesman's orders).
export async function setProductionAssignment(salesmanId, productionId) {
  const { error } = productionId
    ? await supabase.from('production_salesman_assignments')
      .upsert({ salesman_id: salesmanId, production_id: productionId }, { onConflict: 'salesman_id' })
    : await supabase.from('production_salesman_assignments').delete().eq('salesman_id', salesmanId);
  if (error) throw error;
}
