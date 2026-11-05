// The same kertas kerja read once (Sean, 2026-11-05): every AI read costs money, and salesmen resend,
// forward and pass on the same file. The file's bytes + the notes + FORM_READ_VERSION make the key;
// a hit reuses the earlier reading (form_reads, migration 0112) — no AI call, no cost. A file with
// different content, even in the same layout, is a new reading.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { FileContent } from './files.ts';

// Bump when the reading itself changes (prompt / schema), so old readings aren't reused
export const FORM_READ_VERSION = 'form-2026-11-05';

type Reading = { input: Record<string, unknown> } | null;
type Reader = (content: FileContent, fileName: string, notes: string) => Promise<Reading>;

export async function formKey(content: FileContent, notes: string) {
  const bytes = new TextEncoder().encode(`${FORM_READ_VERSION}\n${notes.trim()}\n${JSON.stringify(content)}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// The reading of this file: the saved one, or a fresh one (then saved). `cached` says which.
export async function readFormCached(db: SupabaseClient, read: Reader, content: FileContent, fileName: string, notes: string) {
  const key = await formKey(content, notes);
  const { data, error } = await db.from('form_reads').select('result').eq('key', key).maybeSingle();
  if (error) console.error('form_reads lookup failed:', error.message);
  if (data?.result) return { input: data.result as Record<string, unknown>, cached: true };
  const fresh = await read(content, fileName, notes);
  if (!fresh) return null;
  const { error: saveError } = await db.from('form_reads').upsert({ key, file_name: fileName, result: fresh.input });
  if (saveError) console.error('form_reads save failed:', saveError.message);
  return { input: fresh.input, cached: false };
}
