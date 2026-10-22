// A plaque engraved with a student's name costs RM1 more (Sean, 2026-10-20):
// any plaque whose wording carries a Malay / Indian name word (MOHAMAD, NUR,
// BIN, BINTI, A/L …). Add to Cart prices those plaques at the catalog price
// + NAME_SURCHARGE, as their own item, so Sales sees them on a line of their
// own and a price change on the other line leaves them alone.
export const NAME_SURCHARGE = 1;

const NAME_WORD_RE = /(?:^|[\s(])(?:BIN|BINTI|BINTE|BT|BTE|A\/L|A\/P|MOHAMAD|MOHAMMAD|MUHAMMAD|MUHAMAD|MOHAMED|MOHAMMED|MOHD|MUHD|NUR|NURUL|NOOR|NOR|SITI|AHMAD|ABDUL|ABD)(?=$|[\s.,)])/i;

// The school's own name is never a student's (ORD-0094: "SK TUN ABDUL AZIZ
// MAJID 2026" on every plaque made each one look named).
const SCHOOL_LINE_RE = /(?:^|[^A-Z])(?:SK|SJK|SJKC|SJKT|SMK|SMJK|SRK|SRJK|SEKOLAH)(?![A-Z])/i;

export const hasStudentName = (text) => String(text || '').split('\n')
  .some((line) => !SCHOOL_LINE_RE.test(line.trim()) && NAME_WORD_RE.test(line.trim()));

// Crystals and VB plaques are never charged the extra RM1 for a name (Sean, 2026-10-22).
export const takesNameSurcharge = (jenisPlak) => !/^\s*(CRYSTAL|VB)\s*\//i.test(String(jenisPlak || ''));
