import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
  process.exit(1);
}

console.log(`Connecting to ${supabaseUrl} ...`);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const { error } = await supabase
  .from("__connection_test__")
  .select("*")
  .limit(1);

if (!error) {
  console.log("Connected. (Table '__connection_test__' unexpectedly exists.)");
} else if (error.code === "42P01" || error.code === "PGRST205") {
  // Postgres "relation does not exist" / PostgREST "not in schema cache"
  // -> request reached the DB, credentials are valid
  console.log("Connected successfully: reached your Supabase project and credentials are valid.");
} else if (error.message?.toLowerCase().includes("invalid api key")) {
  console.error("Connection reached Supabase, but the API key was rejected:", error.message);
  process.exit(1);
} else {
  console.error("Connection failed:", error.message);
  process.exit(1);
}
