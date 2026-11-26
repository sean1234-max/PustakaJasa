import { wordsOf } from './sourceCheck';
import { levenshtein } from './typoCheck';

// The order's plaques against the form bot's reading of the teacher's kertas kerja (Sean, 2026-11-26).
// The bot already paid for the reading (form_reads); this is plain code, no AI, no cost.
// Words, not lines: the website splits lines and moves a subject to its own line, so only the
// words are compared — the TAJUK (header) against the kertas kerja's headings, the rest of a plaque
// (red + black) against the kertas kerja's closest plaque.
//   typo     a word the kertas kerja's closest plaque spells a little differently (MUHAMMAD / MUHAMAD)
//   extra    a word the kertas kerja never has
//   missing  a word or two of the kertas kerja's closest plaque (or of its TAJUK) this order lacks
//            (SENI VISUAL where the kertas kerja writes PENDIDIKAN SENI VISUAL)
// Each issue: { kind, where: 'header' | 'plaque', word, kk?, kkText (the kertas kerja's closest plaque), plaque, count }.

const BODY_FIELDS = ['line3', 'line4', 'subject', 'kelas'];
// what the bot fills in for a subject plaque read without its award (formPlaques.ts toFormPlaques)
const MP_DEFAULT_AWARD = 'ANUGERAH MATA PELAJARAN TERBAIK';
const awardOf = (p) => String(p.award ?? '').trim() || (p.type === 'mp_subject' ? MP_DEFAULT_AWARD : '');
const TYPO_MAX_EDITS = 2;
const TYPO_MIN_LENGTH = 4;        // LILY / LILIY; only words of the closest plaque are candidates
const MATCH_MIN_SHARE = 0.75;     // the reading's plaque must hold this share of the plaque's words
const MISSING_MAX_WORDS = 2;      // more lacking = a different plaque, not a lost word
const HEADING_MISSING_MAX = 3;    // a TAJUK may lose the school's name (SK DESA PINGGIRAN PUTRA)
const HEADING_MIN_SHARE = 0.5;    // …but keeps at least half of the kertas kerja's TAJUK

const bodyWords = (p) => wordsOf([p.red, ...(p.black || [])].join(' '));
// The website writes "TAHUN 6" under a subject (mp_subject) and for an ORDER LAIN-LAIN plaque with no
// line ③, but a class plaque is "6 IBNU KHALDUN" (formPlaques.ts toFormPlaques)
const writesTahun = (p) => p.tahun && (p.type === 'mp_subject' || (p.type !== 'mp_class' && !p.line3));
const readBodyWords = (p) => wordsOf([awardOf(p), ...BODY_FIELDS.map((f) => p[f]), writesTahun(p) ? 'TAHUN' : ''].join(' '));
const readPlaquesOf = (readings) => (readings || []).flatMap((r) => r?.plaques || []);

// The kertas kerja plaque holding most of these words (the smaller one on a tie), or -1.
export function closestReading(words, readBodies) {
  let best = -1;
  let bestShared = 0;
  readBodies.forEach((rb, i) => {
    const shared = [...words].filter((w) => rb.has(w)).length;
    if (shared > bestShared || (shared && shared === bestShared && rb.size < readBodies[best].size)) { best = i; bestShared = shared; }
  });
  return best >= 0 && bestShared / words.size >= MATCH_MIN_SHARE ? best : -1;
}

const nearWord = (word, candidates) => (word.length < TYPO_MIN_LENGTH ? null : [...candidates]
  .map((c) => ({ c, d: levenshtein(word, c) }))
  .filter(({ c, d }) => d > 0 && d <= TYPO_MAX_EDITS && c.length >= TYPO_MIN_LENGTH)
  .sort((a, b) => a.d - b.d)[0]?.c || null);

// The kertas kerja plaque as the salesman would read it: TAJUK / award / lines
export const readingText = (p) => [p.heading, awardOf(p), p.line3, p.line4, p.subject, p.tahun ? `TAHUN ${p.tahun}` : '', p.kelas]
  .map((t) => String(t ?? '').trim()).filter(Boolean).join(' / ');

// One question per kind and word — also what a confirmed answer is remembered as (the block's ::kkOk)
export const issueKey = (i) => `${i.where}:${i.kind}:${i.word}${i.kk ? `>${i.kk}` : ''}`;

// A remembered answer (issueKey) in words, for the order screens
export function kkOkLabel(key) {
  const [where, kind, rest = ''] = String(key).split(':');
  const [word, kk] = rest.split('>');
  const place = where === 'header' ? 'TAJUK' : 'plaque';
  if (kind === 'typo') return `${word} (kertas kerja: ${kk})`;
  if (kind === 'missing') return `${place} without ${word}`;
  return `${word} added to the ${place}`;
}

// `plaques`: reviewChecks.aiPlaquesOf(order); `readings`: form_reads results; `known`: other words that
// may be on a plaque (the order's school, teacher).
export function checkAgainstReading(plaques, readings, known = []) {
  const reads = readPlaquesOf(readings);
  if (!reads.length) return [];
  const readBodies = reads.map(readBodyWords);
  const readHeadings = reads.map((p) => wordsOf(p.heading));
  const knownWords = wordsOf([...known, ...(readings || []).map((r) => `${r?.school || ''} ${r?.teacher || ''}`)].join(' '));
  const vocab = new Set([...readBodies, ...readHeadings].flatMap((s) => [...s]).concat([...knownWords]));
  const grouped = new Map();
  (plaques || []).forEach((p) => {
    const header = wordsOf(p.header);
    const words = bodyWords(p);
    const all = new Set([...header, ...words]);
    const best = words.size ? closestReading(words, readBodies) : -1;
    const kkText = best >= 0 ? readingText(reads[best]) : '';
    const add = (issue) => {
      const key = issueKey(issue);
      const hit = grouped.get(key) || { ...issue, kkText, plaque: p, count: 0 };
      grouped.set(key, { ...hit, count: hit.count + (p.count || 1) });
    };
    // the TAJUK only where the kertas kerja's plaque has one (the bot leaves it empty when the file has none)
    const heading = best >= 0 ? readHeadings[best] : new Set();
    if (heading.size) [...header].filter((w) => !vocab.has(w)).forEach((w) => add({ kind: 'extra', where: 'header', word: w }));
    if (!words.size) return;
    // the closest plaque's words this one lacks (anywhere on it: the website may move a line to the TAJUK)
    const lacking = best >= 0 ? [...readBodies[best]].filter((w) => !all.has(w)) : [];
    const taken = new Set();
    [...words].filter((w) => best >= 0 && !readBodies[best].has(w)).forEach((w) => {
      const near = nearWord(w, lacking);
      if (near) { taken.add(near); add({ kind: 'typo', where: 'plaque', word: w, kk: near }); return; }
      if (!vocab.has(w)) add({ kind: 'extra', where: 'plaque', word: w });
    });
    if (best < 0) [...words].filter((w) => !vocab.has(w)).forEach((w) => add({ kind: 'extra', where: 'plaque', word: w }));
    const missing = lacking.filter((w) => !taken.has(w));
    if (missing.length && missing.length <= MISSING_MAX_WORDS) missing.forEach((w) => add({ kind: 'missing', where: 'plaque', word: w }));
    // its own section's TAJUK: a word or three of it nowhere on this plaque (the school's name left out),
    // the rest there — a TAJUK sharing less is the bot's misreading (an award read as the TAJUK)
    const lostHeading = [...heading].filter((w) => !all.has(w));
    const headingKept = heading.size ? 1 - lostHeading.length / heading.size : 0;
    if (lostHeading.length && lostHeading.length <= HEADING_MISSING_MAX && headingKept >= HEADING_MIN_SHARE) {
      lostHeading.forEach((w) => add({ kind: 'missing', where: 'header', word: w }));
    }
  });
  return [...grouped.values()];
}

// How much of the order the reading covers: the share of plaques with a close kertas kerja plaque.
// Low = the reading is of another file (the bot's Excel replaced by another; back-test: wrong pairings 0 %).
export const MIN_READING_COVERAGE = 0.5;
export function readingCoverage(plaques, readings) {
  const readBodies = readPlaquesOf(readings).map(readBodyWords);
  const bodies = (plaques || []).map(bodyWords).filter((w) => w.size);
  if (!bodies.length || !readBodies.length) return 0;
  return bodies.filter((w) => closestReading(w, readBodies) >= 0).length / bodies.length;
}
