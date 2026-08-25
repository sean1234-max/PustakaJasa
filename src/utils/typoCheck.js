// Lightweight typo hinting for Reference Sample / Kuantiti Description
// free-text fields — flags a word that's CLOSE to (but not exactly) a
// known subject/event word, e.g. "ANIGERAH" vs "ANUGERAH" or "BAHESA" vs
// "BAHASA". Deliberately a small, curated word list rather than a real
// spellchecker/dictionary: this app has no way to know whether an
// unfamiliar word is a typo or just a legitimate word/name it's never
// seen (a school's own event name, a person's name, etc.), so only words
// that are near-misses of a KNOWN word are flagged — an entirely
// different (if unrecognized) word is left alone.

// Subject names already used elsewhere in the catalog (src/data/catalog.js's
// SUBJECTS_CORE/SUBJECTS_PBD), split into individual words for word-level
// matching against free-typed Description fields.
const SUBJECT_WORDS = [
  'BAHASA', 'MELAYU', 'INGGERIS', 'MATEMATIK', 'SAINS', 'PENDIDIKAN', 'ISLAM',
  'ARAB', 'SENI', 'VISUAL', 'JASMANI', 'KESIHATAN', 'MUZIK', 'MORAL', 'CINA',
  'TAMIL', 'SEJARAH', 'REKA', 'BENTUK', 'TEKNOLOGI',
];

// Common recurring words in Malaysian school award/event titles (TAJUK
// BESAR, ACARA, etc.) — expand this list as more real event titles are
// seen; it only needs to cover words that actually recur often enough
// that a near-miss is worth flagging.
const EVENT_WORDS = [
  'HARI', 'ANUGERAH', 'KECEMERLANGAN', 'MURID', 'PELAJAR', 'SEKOLAH', 'GURU',
  'TERBAIK', 'SAUJANA', 'LONJAKAN', 'TOKOH', 'KOKURIKULUM', 'KURIKULUM',
  'AKADEMIK', 'SUKAN', 'NILAM', 'PENGHARGAAN', 'MAJLIS', 'GEMILANG',
  'CEMERLANG', 'TAHUN', 'KELAS', 'KEBANGSAAN', 'PERDANA', 'WAWASAN',
  'KONVOKESYEN', 'SIJIL', 'PENTAKSIRAN', 'PRESTASI', 'RUMAH', 'SUKAN',
  'PERMAINAN', 'PERTANDINGAN', 'PERSATUAN', 'UNIT', 'BERUNIFORM', 'KELAB',
  'PRASEKOLAH', 'PPKI',
];

export const TYPO_CHECK_DICTIONARY = [...new Set([...SUBJECT_WORDS, ...EVENT_WORDS])];

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Splits `text` into words and returns the first one that's a near-miss of
// a dictionary word — `{ word, suggestion }` — or null if every word is
// either an exact match, unrecognized-but-not-close-to-anything, or too
// short to check. Deliberately capped at edit distance 1 (one inserted,
// deleted, or substituted character) rather than something looser — real
// typos like "ANIGERAH"/"ANUGERAH" and "BAHESA"/"BAHASA" are already
// distance 1, while distance 2 starts catching legitimate unrelated words
// (e.g. a school name like "SUBANG" is distance 2 from "SUKAN") as false
// positives, which is worse than missing an occasional real typo for a
// hint that's meant to be a light nudge, not an authority.
export function findPossibleTypo(text, dictionary = TYPO_CHECK_DICTIONARY) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const maxDistance = 1;
  for (const raw of words) {
    const word = raw.toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < 3 || dictionary.includes(word)) continue;
    let best = null;
    for (const known of dictionary) {
      if (Math.abs(known.length - word.length) > maxDistance) continue;
      const dist = levenshtein(word, known);
      if (dist > 0 && dist <= maxDistance && (!best || dist < best.dist)) best = { dist, known };
    }
    if (best) return { word: raw, suggestion: best.known };
  }
  return null;
}
