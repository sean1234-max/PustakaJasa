// Copies a finished AI file folder into the school's own folder on the NAS (Sean, 2026-10-21):
//   <SEKOLAH ORDER (SITI)>/<school>/<OUTPUT folder name>/   — e.g. SK KUANG/(DWI-26100507) - SK KUANG/
// A copy: OUTPUT keeps its own. Only when exactly one school folder has the same name (compared
// the way Crystal Studio matches school logos — schoolKey below); otherwise nothing is copied and
// the message says so, never a guess.
import { readdirSync, statSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_SCHOOL_DIR = process.platform === 'win32'
  ? '\\\\TEQGO\\Artwork\\D O U B L E  W I N\\MEDAL\\SEKOLAH ORDER (SITI)'
  : '/Volumes/Artwork/D O U B L E  W I N/MEDAL/SEKOLAH ORDER (SITI)';

// school-dir.txt next to the helper (one line, the path) or SCHOOL_DIR overrides it, like ai-file-dir.txt
export function resolveSchoolDir(helperDir) {
  if (process.env.SCHOOL_DIR) return process.env.SCHOOL_DIR;
  const f = path.join(helperDir, 'school-dir.txt');
  const line = existsSync(f) ? readFileSync(f, 'utf8').trim() : '';
  return line || DEFAULT_SCHOOL_DIR;
}

// Copied from public/crystal/js/logos.js (kept identical by ai-file-helper.test.mjs) — a school's
// name to compare by.
export function schoolKey(name) {
  let s = " " + String(name || "").toUpperCase().replace(/\(\s*([A-Z])\s*\)/g, "$1").replace(/[^A-Z0-9]+/g, " ") + " ";
  const short = [
    [/ SEKOLAH MENENGAH KEBANGSAAN /g, " SMK "], [/ SEKOLAH JENIS KEBANGSAAN CINA /g, " SJKC "],
    [/ SEKOLAH JENIS KEBANGSAAN TAMIL /g, " SJKT "], [/ SEKOLAH JENIS KEBANGSAAN /g, " SJK "],
    [/ SEKOLAH KEBANGSAAN /g, " SK "], [/ SEKOLAH RENDAH /g, " SR "], [/ SEKOLAH MENENGAH /g, " SM "],
    [/ SJK C /g, " SJKC "], [/ SJK T /g, " SJKT "],
    // "B.B.BANGI" / "BB BANGI" = BANDAR BARU BANGI (SK SEKSYEN 7 B.B.BANGI, Sean 2026-10-21)
    [/ B B /g, " BANDAR BARU "], [/ BB /g, " BANDAR BARU "],
  ];
  for (const [re, to] of short) s = s.replace(re, to);
  // short forms of words written either way: TMN = TAMAN, SRI = SERI …
  return s.replace(/\s+/g, " ").trim().split(" ").map((w) => WORDS[w] || w).join(" ");
}
const WORDS = { TMN: "TAMAN", SRI: "SERI", KG: "KAMPUNG", KPG: "KAMPUNG", BDR: "BANDAR", JLN: "JALAN", BKT: "BUKIT", SG: "SUNGAI", SGI: "SUNGAI", PDG: "PADANG", LDG: "LADANG", BT: "BATU" };

// The one folder under root named as this school, or { error } saying why none was used.
export function findSchoolFolder(root, school, names = null) {
  const key = schoolKey(school);
  if (!key) return { error: 'no school name on the order' };
  let list = names;
  if (!list) {
    try { list = readdirSync(root).filter((n) => statSync(path.join(root, n)).isDirectory()); } catch { return { error: `can't reach ${root}` }; }
  }
  // a folder named exactly so (the website's own list, src/data/schoolFolders.js) wins
  const exact = list.filter((n) => n.trim().toUpperCase() === String(school).trim().toUpperCase());
  if (exact.length === 1) return { dir: path.join(root, exact[0]), name: exact[0] };
  const same = list.filter((n) => schoolKey(n) === key);
  if (same.length === 1) return { dir: path.join(root, same[0]), name: same[0] };
  return { error: same.length ? `more than one school folder matches (${same.join(', ')})` : `no school folder named "${school}"` };
}

// The .ai files of src copied into <school folder>/<src folder name>; returns a line for the page.
export function copyToSchool(src, school, root) {
  if (!school || !existsSync(src)) return '';
  const found = findSchoolFolder(root, school);
  if (found.error) return `Not copied to the school folder: ${found.error} — copy it by hand from OUTPUT.`;
  const dest = path.join(found.dir, path.basename(src));
  try {
    mkdirSync(dest, { recursive: true });
    const files = readdirSync(src).filter((n) => /\.ai$/i.test(n));
    files.forEach((n) => copyFileSync(path.join(src, n), path.join(dest, n)));
    return `Copied ${files.length} file(s) to the school folder: ${dest}`;
  } catch (err) {
    return `Not copied to the school folder: ${err.message} — copy it by hand from OUTPUT.`;
  }
}
