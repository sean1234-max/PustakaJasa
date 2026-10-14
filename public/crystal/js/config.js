// Where Crystal Studio keeps its designs, master template and saved work: the order website's own
// Supabase project (tables from supabase/migrations/0089_crystal_studio.sql). The studio is served
// by the order website (/crystal/), so it uses the website's login: nothing can be read or saved
// without being signed in, and what each account may change is decided by its role there.
//
// The key here is the project's PUBLISHABLE key: it is meant to be in web pages (the website's
// bundle has it too). Never put a secret key here; the page refuses it.
export const SUPABASE_URL = "https://dlzkdkxbnbhgldsvbybt.supabase.co";
export const SUPABASE_KEY = "sb_publishable_8aowsSknic2V2swKJcFMUQ_mOraHKXk";
