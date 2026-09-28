// Forces the two-line layout the plaque needs for a few well-known ACARA /
// position wordings that are too long to sit on one line:
//   ANUGERAH PBD MATA PELAJARAN TERBAIK -> "ANUGERAH PBD" / "MATA PELAJARAN TERBAIK"
//   ANUGERAH MATA PELAJARAN TERBAIK     -> "ANUGERAH MATA PELAJARAN" / "TERBAIK"
//   ANUGERAH KEHADIRAN PENUH/TERBAIK    -> "ANUGERAH" / "KEHADIRAN PENUH"|"KEHADIRAN TERBAIK"
//   TERBAIK MATA PELAJARAN              -> "TERBAIK" / "MATA PELAJARAN"
//   any other ANUGERAH ...              -> "ANUGERAH" / the rest
//     (ANUGERAH MURID BERPOTENSI, ANUGERAH SAHSIAH TERPUJI, ...)
// The specific wordings above win over the general ANUGERAH rule, and an
// "ANUGERAH PBD" / "ANUGERAH MATA PELAJARAN" wording is never split after
// ANUGERAH alone (those names belong on the first line). Text that
// already carries a line break (a teacher's own Alt+Enter) or matches no
// pattern is returned untouched, so this is safe to apply again on every
// import/export.
const PBD_RE = /^(ANUGERAH\s+PBD)\s+(\S[\s\S]*)$/i;
const MATA_PELAJARAN_RE = /^(ANUGERAH\s+MATA\s+PELAJARAN)\s+(TERBAIK)$/i;
const KEHADIRAN_RE = /^(ANUGERAH)\s+(KEHADIRAN\s+(?:PENUH|TERBAIK))$/i;
const TERBAIK_MATA_PELAJARAN_RE = /^(TERBAIK)\s+(MATA\s+PELAJARAN)$/i;
const ANUGERAH_RE = /^(ANUGERAH)\s+(?!PBD\b|MATA\s+PELAJARAN\b)(\S[\s\S]*)$/i;

// `generalAnugerah` false keeps a wording on one line unless a specific rule
// above applies — for ACARA text that lands on a one-line box (ALIRAN's
// event_line_1), not the position.
export function breakAcaraLine(text, generalAnugerah = true) {
  const s = String(text ?? '');
  if (!s.trim() || s.includes('\n')) return s;
  const m = s.trim().match(PBD_RE) || s.trim().match(MATA_PELAJARAN_RE)
    || s.trim().match(KEHADIRAN_RE) || s.trim().match(TERBAIK_MATA_PELAJARAN_RE)
    || (generalAnugerah ? s.trim().match(ANUGERAH_RE) : null);
  return m ? `${m[1]}\n${m[2]}` : s;
}
