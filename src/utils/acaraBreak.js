// Forces the two-line layout the plaque needs for a few well-known ACARA /
// position wordings that are too long to sit on one line:
//   ANUGERAH PBD MATA PELAJARAN TERBAIK -> "ANUGERAH PBD" / "MATA PELAJARAN TERBAIK"
//   ANUGERAH MATA PELAJARAN TERBAIK     -> "ANUGERAH MATA PELAJARAN" / "TERBAIK"
//   ANUGERAH KEHADIRAN PENUH/TERBAIK    -> "ANUGERAH" / "KEHADIRAN PENUH"|"KEHADIRAN TERBAIK"
// Text that already carries a line break (a teacher's own Alt+Enter) or
// matches neither pattern is returned untouched, so this is safe to apply
// again on every import/export.
const PBD_RE = /^(ANUGERAH\s+PBD)\s+(\S[\s\S]*)$/i;
const MATA_PELAJARAN_RE = /^(ANUGERAH\s+MATA\s+PELAJARAN)\s+(TERBAIK)$/i;
const KEHADIRAN_RE = /^(ANUGERAH)\s+(KEHADIRAN\s+(?:PENUH|TERBAIK))$/i;

export function breakAcaraLine(text) {
  const s = String(text ?? '');
  if (!s.trim() || s.includes('\n')) return s;
  const m = s.trim().match(PBD_RE) || s.trim().match(MATA_PELAJARAN_RE) || s.trim().match(KEHADIRAN_RE);
  return m ? `${m[1]}\n${m[2]}` : s;
}
