import * as XLSX from 'xlsx';
import JSZip from 'jszip';

// Production's check: the teacher's / salesman's own file against the order (Sean, 2026-10-22).
// Word by word (lines and their order differ too much between a file and the plaques): words in
// the file that are on no plaque (a line lost in the import), and words on the plaques that aren't
// in the file (an extra or changed line). The blank FORM ANUGERAH's own words, the order's
// details (school, cikgu, remark) and order-form words (KOD, HARGA, PCS …) don't count.

const FORM_WORDS = new Set(('KOD CODE HARGA RM SEUNIT UNIT PCS PC PIECES PIECE JUMLAH TOTAL QTY KUANTITI BIL BILANGAN '
  + 'WORDING NAMA LABEL TEMPAHAN PLAK PLAQUE PLAQE WOODEN KRISTAL CRYSTAL JENIS HADIAH DESIGN WARNA ACARA CONTOH NO '
  + 'TARIKH CIKGU TEL HP DAN THE AND').split(' '));

export const wordsOf = (text) => new Set((String(text || '').toUpperCase().match(/[A-Z]{3,}/g) || []).filter((w) => !FORM_WORDS.has(w)));

// Every text in an uploaded .xlsx (visible sheets, FRONT PG left out) / .docx (paragraphs and
// text boxes); null for a file type it can't read (PDF).
export async function fileText(buffer, name) {
  if (/\.xlsx$/i.test(name)) {
    const wb = XLSX.read(buffer, { type: 'array' });
    return wb.SheetNames
      .filter((n, i) => !wb.Workbook?.Sheets?.[i]?.Hidden && !/^FRONT\s*PG$/i.test(n.trim()))
      .map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).flat().join('\n'))
      .join('\n');
  }
  if (/\.docx$/i.test(name)) {
    const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml')?.async('text');
    return xml ? xml.replace(/<w:tab\/>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&') : '';
  }
  return null;
}

// `fileTexts`: the uploaded files' texts; `templateText`: the blank form's; `plaqueText`: every
// engraved line of the order; `orderText`: the order's own details. -> { missing, extra } words.
export function compareWords({ fileTexts, templateText = '', plaqueText, orderText = '' }) {
  const inFile = wordsOf(fileTexts.join('\n'));
  const onPlaques = wordsOf(plaqueText);
  const ignore = new Set([...wordsOf(templateText), ...wordsOf(orderText)]);
  return {
    missing: [...inFile].filter((w) => !onPlaques.has(w) && !ignore.has(w)),
    extra: [...onPlaques].filter((w) => !inFile.has(w)),
  };
}
