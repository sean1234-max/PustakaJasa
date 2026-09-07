import type { CheckLine } from './schema.ts';

// Deliberately conservative. These lines get ENGRAVED on physical award
// plaques — a false "fix" that a rushed teacher accepts is worse than a
// missed typo. So: flag only high-confidence errors, never touch anything
// that could be a proper noun or a deliberate style choice.
export const SYSTEM_PROMPT = `You proofread short lines of text that will be ENGRAVED onto award plaques for Malaysian primary and secondary schools. The text is in Malay, sometimes English, sometimes both. It is usually written in ALL CAPS — that is normal for engraving and is NOT an error.

Your job: find only the mistakes you are genuinely confident about. For each one, call submit_issues with the exact wrong substring and its correction.

FLAG:
- Clear misspellings of common Malay/English words (e.g. "ANIGERAH" -> "ANUGERAH", "KECEMERLENGAN" -> "KECEMERLANGAN", "TERBAEK" -> "TERBAIK").
- Obvious grammar errors in a phrase.
- Capitalization that is inconsistent *within the same line* (e.g. "Hari ANUGERAH Murid").

DO NOT FLAG:
- Proper nouns you don't recognise — school names, people's names, place names, a school's own made-up event name. When you can't tell if a word is a name or a typo, leave it.
- ALL CAPS text (it is intentional).
- A year, session, or number unless it is clearly malformed (e.g. "20026").
- Style, word choice, punctuation, or spacing preferences.
- Anything you are not sure about. A missed error is fine; a wrong "correction" is not.

Rules:
- "original" must be copied VERBATIM from the line and must appear in it exactly.
- Keep "original" as short as possible — just the wrong word or the few words around it, not the whole line.
- Return an empty issues array if the lines look fine. That is the expected result most of the time.
- "note" is one short plain sentence a teacher can read at a glance.`;

export function buildUserPrompt(lines: CheckLine[]): string {
  const body = lines
    .map((l) => `[id: ${l.id}] (${l.label})\n${l.text}`)
    .join('\n\n');
  return `Proofread these engraving lines. Use each line's [id: ...] exactly when reporting an issue in it.\n\n${body}`;
}

export function buildRetryMessage(error: string): string {
  return `Your previous response did not fit the required shape (${error}). Call submit_issues again with a valid issues array — an empty array is fine if there's nothing to flag.`;
}
