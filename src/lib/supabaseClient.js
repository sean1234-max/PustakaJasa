import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Check your .env file."
  );
}

// autoRefreshToken/persistSession are the library defaults — set explicitly
// so it's obvious the app relies on the token being kept fresh in the
// background (and on AppState's onAuthStateChange 'SIGNED_OUT' handler for
// when a refresh finally can't be done). detectSessionInUrl is off: this
// app never does an OAuth / magic-link redirect, so there's no auth code
// to parse out of the URL.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
