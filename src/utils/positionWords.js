// Position words on a plaque (Sean, 2026-10-20).
//   - TEMPAT: when the order's own wording says "Tempat Pertama", a line
//     that is just the ordinal (PERTAMA, KEDUA …) is engraved "TEMPAT
//     PERTAMA"; without it, "PERTAMA" stays — the same way "TAHUN" is kept
//     only when the file has it. "Tempat" only in a price list doesn't count.
//   - Red by default: a place line (PERTAMA / TEMPAT PERTAMA …) first; with
//     none, a line with ANUGERAH, else KEHADIRAN, else KEDUDUKAN in it, even one that
//     also says SEKOLAH (a MAJLIS / HARI ANUGERAH title line stays the black
//     TAJUK BESAR). Same rule on the website and in the FORM ANUGERAH.
const ORDINALS = 'PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KELAPAN|KESEMBILAN|KESEPULUH';
const TEMPAT_RE = new RegExp(`\\bTEMPAT\\s+(?:KE-?\\s*\\d+|${ORDINALS})\\b`, 'i');
const ORDINAL_LINE_RE = new RegExp(`^(?:${ORDINALS})$`, 'i');
// In this order: an ANUGERAH line ahead of a KEHADIRAN one, then KEDUDUKAN.
export const RED_WORD_RES = [/\bANUGERAH\b/i, /\bKEHADIRAN\b/i, /\bKEDUDUKAN\b/i];
// A title line, never the red one: MAJLIS …, HARI ANUGERAH …
export const TITLE_LINE_RE = /\b(?:MAJLIS|HARI)\b/i;
// A line that is only a place (PERTAMA, TEMPAT KEDUA …): red ahead of an
// ANUGERAH line (Sean, 2026-10-20).
export const PLACE_LINE_RE = new RegExp(`^(?:TEMPAT\\s+)?(?:${ORDINALS})$`, 'i');

export const fileSaysTempat = (text) => TEMPAT_RE.test(String(text || ''));

// "PERTAMA" -> "TEMPAT PERTAMA" (in the line's own case); anything else as is.
export function withTempat(line) {
  const t = String(line ?? '').trim();
  if (!ORDINAL_LINE_RE.test(t)) return line;
  return `${t === t.toUpperCase() ? 'TEMPAT' : 'Tempat'} ${t}`;
}

// "TAHUN SATU" -> "TAHUN 1": a year level is always engraved as a number,
// even when the file's table heads its columns SATU / DUA / TIGA (Sean,
// 2026-10-20).
const TAHUN_WORDS = { SATU: 1, DUA: 2, TIGA: 3, EMPAT: 4, LIMA: 5, ENAM: 6 };
const TAHUN_WORD_RE = /\b(TAHUN|Tahun|tahun)\s+(SATU|DUA|TIGA|EMPAT|LIMA|ENAM)\b/gi;
export function tahunDigits(line) {
  if (typeof line !== 'string') return line;
  return line.replace(TAHUN_WORD_RE, (_, tahun, word) => `${tahun} ${TAHUN_WORDS[word.toUpperCase()]}`);
}
