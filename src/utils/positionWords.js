// Position words on a plaque (Sean, 2026-10-20).
//   - TEMPAT: when the order's own wording says "Tempat Pertama", a line
//     that is just the ordinal (PERTAMA, KEDUA …) is engraved "TEMPAT
//     PERTAMA"; without it, "PERTAMA" stays — the same way "TAHUN" is kept
//     only when the file has it. "Tempat" only in a price list doesn't count.
//   - ANUGERAH: a plaque line with ANUGERAH in it is red by default (a
//     MAJLIS / HARI ANUGERAH title line stays the black TAJUK BESAR).
const ORDINALS = 'PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA|KEENAM|KETUJUH|KELAPAN|KESEMBILAN|KESEPULUH';
const TEMPAT_RE = new RegExp(`\\bTEMPAT\\s+(?:KE-?\\s*\\d+|${ORDINALS})\\b`, 'i');
const ORDINAL_LINE_RE = new RegExp(`^(?:${ORDINALS})$`, 'i');
export const ANUGERAH_RE = /\bANUGERAH\b/i;

export const fileSaysTempat = (text) => TEMPAT_RE.test(String(text || ''));

// "PERTAMA" -> "TEMPAT PERTAMA" (in the line's own case); anything else as is.
export function withTempat(line) {
  const t = String(line ?? '').trim();
  if (!ORDINAL_LINE_RE.test(t)) return line;
  return `${t === t.toUpperCase() ? 'TEMPAT' : 'Tempat'} ${t}`;
}
