// The only server-side code in this project — everything else talks to
// Supabase directly from the browser via RLS. Creating a Supabase Auth
// user for someone else, or setting their password directly, are Admin
// API operations that require the service_role key. That key must never
// reach the browser (it bypasses RLS entirely), so this function is the
// sole place it's used — and only after re-verifying, server-side, that
// the caller is actually an admin. The client's own claim of being an
// admin is never trusted.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const VALID_ROLES = ['teacher', 'salesman', 'production', 'admin'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header.' }, 401);

  // Two clients: one scoped to the caller's own session (only to identify
  // who they are), one with the service role (for the actual admin
  // operation, and to look up the caller's real role — bypassing RLS, so
  // it can't be spoofed by manipulating what the client sends).
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: 'Not authenticated.' }, 401);

  const { data: callerProfile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (profileError || callerProfile?.role !== 'admin') {
    return jsonResponse({ error: 'Only admins can do this.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body.' }, 400);
  }

  if (body.action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = typeof body.role === 'string' ? body.role : '';
    const sekolah = typeof body.sekolah === 'string' ? body.sekolah : null;
    const displayName = typeof body.displayName === 'string' ? body.displayName : null;

    if (!email || !password || !role) {
      return jsonResponse({ error: 'Email, password, and role are required.' }, 400);
    }
    if (!VALID_ROLES.includes(role)) {
      return jsonResponse({ error: 'Invalid role.' }, 400);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (createError || !created?.user) {
      const message = createError?.message?.includes('already been registered')
        ? 'This email address is already being used. Please use another email address.'
        : 'Unable to create the account. Please try again.';
      return jsonResponse({ error: message }, 400);
    }

    const { error: insertError } = await adminClient.from('profiles').insert({
      id: created.user.id,
      role,
      sekolah,
      display_name: displayName,
      email,
      status: 'active',
    });
    if (insertError) {
      // Roll back the auth user rather than leave an orphaned account with
      // no profile row — that account would fail login with "No role
      // found for this account" and be invisible to Admin's user list.
      await adminClient.auth.admin.deleteUser(created.user.id);
      return jsonResponse({ error: 'Unable to create the account. Please try again.' }, 500);
    }

    return jsonResponse({ id: created.user.id });
  }

  if (body.action === 'reset_password') {
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!userId || !newPassword) {
      return jsonResponse({ error: 'User and new password are required.' }, 400);
    }
    const { error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (updateError) {
      return jsonResponse({ error: 'Unable to change the password. Please try again.' }, 500);
    }
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Unknown action.' }, 400);
});
