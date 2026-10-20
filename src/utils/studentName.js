// A plaque engraved with a student's name costs RM1 more (Sean, 2026-10-20):
// any plaque whose wording carries a Malay / Indian name word (MOHAMAD, NUR,
// BIN, BINTI, A/L …). Add to Cart prices those plaques at the catalog price
// + NAME_SURCHARGE, as their own item, so Sales sees them on a line of their
// own and a price change on the other line leaves them alone.
export const NAME_SURCHARGE = 1;

const NAME_WORD_RE = /(?:^|[\s(])(?:BIN|BINTI|BINTE|BT|BTE|A\/L|A\/P|MOHAMAD|MOHAMMAD|MUHAMMAD|MUHAMAD|MOHAMED|MOHAMMED|MOHD|MUHD|NUR|NURUL|NOOR|NOR|SITI|AHMAD|ABDUL|ABD)(?=$|[\s.,)])/i;

export const hasStudentName = (text) => String(text || '').split('\n').some((line) => NAME_WORD_RE.test(line.trim()));
