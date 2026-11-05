// The bots' database client (secret key — they act for Production, not a signed-in user)

import { createClient } from 'npm:@supabase/supabase-js@2';

export const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
export const db = createClient(SUPABASE_URL, JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']);
