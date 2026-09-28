import { supabase } from './supabaseClient';

// Admin-managed additions to src/utils/typoCheck.js's built-in word list —
// see supabase/migrations/0074_custom_typo_words.sql. Read by everyone
// (the typo hint applies while any teacher is typing an order, not just on
// the Admin page); only admin can add/remove.
export async function fetchCustomTypoWords() {
  const { data, error } = await supabase
    .from('custom_typo_words')
    .select('id, word, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function addCustomTypoWord(word) {
  const trimmed = (word || '').trim();
  if (!trimmed) throw new Error('Enter a word first.');
  const { error } = await supabase.from('custom_typo_words').insert({ word: trimmed });
  if (error) {
    if (error.code === '23505') throw new Error(`"${trimmed}" is already in the dictionary.`);
    throw error;
  }
}

export async function removeCustomTypoWord(id) {
  const { error } = await supabase.from('custom_typo_words').delete().eq('id', id);
  if (error) throw error;
}
