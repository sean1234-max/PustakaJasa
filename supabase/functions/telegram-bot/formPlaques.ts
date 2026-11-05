// The form bot's reading of a teacher's kertas kerja → the plaques templateExport.js fillOrderTemplate
// writes into FORM ANUGERAH. Sean, 2026-11-04: only ORDER LAIN-LAIN and the MP THP sheets —
//   umum        → ORDER LAIN-LAIN, a row per wording (`oneSheet`)
//   mp_class    → MP THP 1 / 2 (Kalau ada kelas): a subject per row, each class under its Tahun
//   mp_subject  → MP THP 1 / 2: a subject per row, its count under each Tahun
// A plaque the MP sheets can't hold goes to ORDER LAIN-LAIN by fillOrderTemplate itself.
// Sashes (SELEMPANG, 2026-11-05) go to the SELEMPANG sheet: ACARA / WARNA / KUANTITI.

export type ReadPlaque = {
  type: 'umum' | 'mp_class' | 'mp_subject';
  heading: string; award: string; line3: string; line4: string;
  subject: string; tahun: number | null; kelas: string;
  qty: number; code: string;
};

export type FormPlaque = { heading: string; award: string; line: string; eline2: string; qty: number; code: string; oneSheet?: boolean; kind?: string };

const clean = (s: unknown) => String(s ?? '').trim();
const TAHUN_OK = (t: unknown): t is number => Number.isInteger(t) && (t as number) >= 1 && (t as number) <= 6;

export function toFormPlaques(read: ReadPlaque[]): FormPlaque[] {
  return (read || []).flatMap((p) => {
    const qty = Math.floor(Number(p.qty) || 0);
    if (qty <= 0) return [];
    const base = { heading: clean(p.heading), qty, code: clean(p.code) };
    const subject = clean(p.subject);
    if (p.type === 'mp_class' && subject && TAHUN_OK(p.tahun) && clean(p.kelas)) {
      return [{ ...base, award: subject, line: `${p.tahun} ${clean(p.kelas)}`, eline2: '' }];
    }
    if (p.type === 'mp_subject' && subject && TAHUN_OK(p.tahun)) {
      return [{ ...base, kind: p.tahun <= 3 ? 'MP1' : 'MP2', award: clean(p.award) || 'ANUGERAH MATA PELAJARAN TERBAIK', line: subject, eline2: `TAHUN ${p.tahun}` }];
    }
    // ORDER LAIN-LAIN; an MP plaque missing its subject / Tahun / class lands here with what it has
    const lines = [clean(p.award) || subject, clean(p.line3) || (TAHUN_OK(p.tahun) ? [`TAHUN ${p.tahun}`, clean(p.kelas)].filter(Boolean).join(' ') : clean(p.kelas)), clean(p.line4)];
    return [{ ...base, oneSheet: true, award: lines[0], line: lines[1], eline2: lines[2] }];
  });
}

export type ReadSelempang = { acara: string; warna: string; qty: number };
export type FormSelempang = { acara: string; warna: string; qty: number };

// The website's four sash colours (catalog.js SELEMPANG_WARNA); anything else stays blank for the salesman
const WARNA = ['BIRU', 'HIJAU', 'KUNING', 'MERAH'];

export function toFormSelempang(read: ReadSelempang[]): FormSelempang[] {
  return (read || []).flatMap((s) => {
    const qty = Math.floor(Number(s.qty) || 0);
    const acara = clean(s.acara);
    if (qty <= 0 || !acara) return [];
    const warna = clean(s.warna).toUpperCase();
    return [{ acara, warna: WARNA.includes(warna) ? warna : '', qty }];
  });
}
