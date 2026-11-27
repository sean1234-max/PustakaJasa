import { wordsOf } from './sourceCheck';
import { getTypoDictionary, levenshtein } from './typoCheck';

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
  if (kind === 'file') return 'the kertas kerja is right although it differs a lot';
  if (kind === 'typo') return `${word} (the file: ${kk})`;
  if (kind === 'join') return `${word} as written (not ${kk})`;
  if (kind === 'same') return `the same plaque on more than one row: ${word.replace(/_AND_(\d+)_MORE$/, ' (and $1 more)').replace(/_/g, ' ')}`;
  if (kind === 'missing') return `${place} without ${word}`;
  return `${word} added to the ${place}`;
}

// One entry per question, counted over every plaque that has it (the first plaque kept, to draw it)
function issueList() {
  const grouped = new Map();
  return {
    add: (issue, p, kkText) => {
      const key = issueKey(issue);
      const hit = grouped.get(key) || { ...issue, kkText, plaque: p, count: 0 };
      grouped.set(key, { ...hit, count: hit.count + (p.count || 1) });
    },
    all: () => [...grouped.values()],
  };
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
  const issues = issueList();
  (plaques || []).forEach((p) => {
    const header = wordsOf(p.header);
    const words = bodyWords(p);
    const all = new Set([...header, ...words]);
    const best = words.size ? closestReading(words, readBodies) : -1;
    const kkText = best >= 0 ? readingText(reads[best]) : '';
    const add = (issue) => issues.add(issue, p, kkText);
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
  return issues.all();
}

// ------------------------------------------------------------------ the salesman's own kertas kerja
// No reading, only its printed lines (kertasKerjaText.js). A plaque is checked against the line most of whose
// words it carries ("PENDIDIKAN SENI VISUAL | TAHUN 1-6 | 6"); a word nowhere in the file is asked about.
const LINE_MIN_SHARE = 0.6;  // the share of the line's words on the plaque
const LINE_MIN_SHARED = 2;   // one shared word ("ANUGERAH") says nothing

export function closestLine(words, lineWords) {
  let best = -1;
  let bestScore = 0;
  let bestShared = 0;
  lineWords.forEach((lw, i) => {
    const shared = [...lw].filter((w) => words.has(w)).length;
    if (shared < LINE_MIN_SHARED) return;
    const score = shared / lw.size;
    if (score > bestScore || (score === bestScore && shared > bestShared)) { best = i; bestScore = score; bestShared = shared; }
  });
  return bestScore >= LINE_MIN_SHARE ? best : -1;
}

// The kertas kerja's lines made ready once for many checks (a file can have 4,000 lines): `lines` from
// kertasKerjaLines() of every kertas kerja on the order; `known` as above; `notOnPlaque`: words a kertas kerja
// line carries that never go on a plaque — the Jenis Plak codes (PKC 263, GOLD, SONGKET BLUE). `good`: the
// spelling check's words (typoCheck.js) — one on a plaque the file spells a little differently is the file's
// mistake, not asked about (SASIAH in the Excel where the website already wrote SAHSIAH, ORD-0599).
export function indexLines(lines, known = [], notOnPlaque = [], good = getTypoDictionary()) {
  const lineWords = (lines || []).map(wordsOf);
  // words the website writes itself: a subject plaque's award, "TAHUN 6"
  const own = wordsOf([...known, MP_DEFAULT_AWARD, 'TAHUN'].join(' '));
  const vocab = new Set([...lineWords.flatMap((w) => [...w]), ...own]);
  const goodSet = new Set(good);
  // the file's words that aren't on the list: where a listed plaque word's misspelling would be
  const odd = [...vocab].filter((w) => !goodSet.has(w));
  return { lines: lines || [], lineWords, vocab, own, odd, skip: wordsOf(notOnPlaque.join(' ')), good: goodSet };
}

export const checkAgainstLines = (plaques, lines, known = [], notOnPlaque = [], opts = {}) => checkLines(plaques, indexLines(lines, known, notOnPlaque), opts);

// `wholePlaque` (the order's own Excel, Sean 2026-11-27): a word is missing only where the closest line holds
// every word of the plaque (the website's own "TAHUN" aside) — its siblings (TEMPAT PERTAMA for TEMPAT KEDUA,
// IBNU SINA for IBNU KHALDUN) don't.
export function checkLines(plaques, { lines, lineWords, vocab, own = new Set(), odd = [], skip, good = new Set() }, { wholePlaque = false } = {}) {
  if (!lineWords.some((w) => w.size)) return [];
  const issues = issueList();
  (plaques || []).forEach((p) => {
    const header = wordsOf(p.header);
    const words = bodyWords(p);
    const all = new Set([...header, ...words]);
    const best = words.size ? closestLine(words, lineWords) : -1;
    const add = (issue) => issues.add(issue, p, best >= 0 ? lines[best] : '');
    [...header].filter((w) => !vocab.has(w)).forEach((w) => add({ kind: 'extra', where: 'header', word: w }));
    const lacking = best >= 0 ? [...lineWords[best]].filter((w) => !all.has(w) && !skip.has(w)) : [];
    const taken = new Set();
    [...words].filter((w) => best < 0 || !lineWords[best].has(w)).forEach((w) => {
      const near = nearWord(w, lacking);
      // a listed word against the file's unlisted near-miss is the file's mistake; against another listed word
      // (TAHAP / TAHUN, KELAS / KEMAS) it is a real difference
      if (near) { taken.add(near); if (!good.has(w) || good.has(near)) add({ kind: 'typo', where: 'plaque', word: w, kk: near }); return; }
      if (vocab.has(w) || (good.has(w) && nearWord(w, odd))) return;
      add({ kind: 'extra', where: 'plaque', word: w });
    });
    const missing = lacking.filter((w) => !taken.has(w));
    const holdsPlaque = !wholePlaque || (best >= 0 && [...words].every((w) => lineWords[best].has(w) || own.has(w)));
    if (holdsPlaque && missing.length && missing.length <= MISSING_MAX_WORDS) missing.forEach((w) => add({ kind: 'missing', where: 'plaque', word: w }));
  });
  return issues.all();
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

// How much of the order's wording is anywhere in the kertas kerja: the share of the plaques' distinct words.
// Low = it is another school's or event's file — one question about the file instead of dozens of words.
export const MIN_LINES_COVERAGE = 0.5;
export function linesCoverage(plaques, linesOrIndex) {
  const vocab = linesOrIndex?.vocab || new Set((linesOrIndex || []).flatMap((l) => [...wordsOf(l)]));
  const words = new Set((plaques || []).flatMap((p) => [...bodyWords(p)]));
  return words.size ? [...words].filter((w) => vocab.has(w)).length / words.size : 1;
}
export const WRONG_FILE_ISSUE = { kind: 'file', where: 'plaque', word: 'FILE' };
