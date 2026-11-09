// Which website school a salesman means (Sean, 2026-11-10): salesmen type it in lowercase or short —
// "skpp 14 (1)" is SK PUTRAJAYA PRESINT 14(1). No database here; orderChat.ts askSchool uses it:
//   1. the same name, case / spaces / brackets ignored;
//   2. a short form picked before (school_aliases, 0121);
//   3. names containing it;
//   4. the closest few (initials, words, numbers) as buttons, with [None of these].

export type SchoolRow = { id: string; sekolah: string; school_language?: string | null };

export const schoolKey = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const tokens = (s: string) => String(s ?? '').toUpperCase().match(/[A-Z]+|[0-9]+/g) || [];

// "SKPP" made of the starts of words in a row: SK + P(UTRAJAYA) + P(RESINT)
function fromWordStarts(tok: string, words: string[]) {
  const from = (pos: number, w: number): boolean => {
    if (pos === tok.length) return true;
    if (w >= words.length) return false;
    for (let n = Math.min(words[w].length, tok.length - pos); n >= 1; n--) {
      if (words[w].slice(0, n) === tok.slice(pos, pos + n) && from(pos + n, w + 1)) return true;
    }
    return false;
  };
  return words.some((_, w) => from(0, w));
}

// How well a typed name fits a school: 0 = not at all. Every number typed must be in the name.
export function schoolScore(typed: string, sekolah: string) {
  const q = tokens(typed);
  const words = tokens(sekolah).filter((t) => /[A-Z]/.test(t));
  const nums = tokens(sekolah).filter((t) => /^[0-9]+$/.test(t)).map(Number);
  const qNums = q.filter((t) => /^[0-9]+$/.test(t)).map(Number);
  const qWords = q.filter((t) => /[A-Z]/.test(t));
  if (!qWords.length && !qNums.length) return 0;
  if (qNums.some((n) => !nums.includes(n))) return 0;
  let hit = 0;
  for (const w of qWords) {
    if (words.includes(w)) hit += 1;
    else if (w.length >= 3 && words.some((x) => x.startsWith(w))) hit += 0.8;
    else if (w.length >= 2 && fromWordStarts(w, words)) hit += 0.9;
  }
  if (qWords.length && !hit) return 0;
  const wordPart = qWords.length ? hit / qWords.length : 1;
  // a name with words nobody typed fits a bit less; the same numbers, in full, fit a bit more
  const extra = Math.max(0, words.length - qWords.length) * 0.02;
  const numPart = qNums.length && qNums.length === nums.length ? 0.1 : 0;
  return Math.max(0.01, wordPart + numPart - extra);
}

export const MIN_SCORE = 0.5;

/** The closest schools to a typed name, best first. */
export function closestSchools<T extends SchoolRow>(typed: string, schools: T[], max = 5): T[] {
  return schools
    .map((s) => ({ s, score: schoolScore(typed, s.sekolah) }))
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.s.sekolah.length - b.s.sekolah.length)
    .slice(0, max)
    .map((x) => x.s);
}

/** Steps 1 and 3 (2 needs the database): the one school it is, or the few it may be. */
export function matchSchool<T extends SchoolRow>(typed: string, schools: T[]): { pick: T } | { choices: T[] } {
  const key = schoolKey(typed);
  if (!key) return { choices: [] };
  const same = schools.filter((s) => schoolKey(s.sekolah) === key);
  if (same.length === 1) return { pick: same[0] };
  if (same.length > 1) return { choices: same.slice(0, 8) };
  const containing = schools.filter((s) => schoolKey(s.sekolah).includes(key));
  if (containing.length === 1) return { pick: containing[0] };
  if (containing.length) return { choices: containing.sort((a, b) => a.sekolah.length - b.sekolah.length).slice(0, 8) };
  return { choices: closestSchools(typed, schools) };
}
