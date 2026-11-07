// A file sent to the bot, turned into what the model can read: a PDF or a picture as itself, an
// Excel as each sheet's cells (CSV), a Word file as its text. null = a kind it can't read.

import * as XLSX from 'npm:xlsx@0.18.5';
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const MAX_TEXT_CHARS = 60000;

export type FileContent =
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'text'; text: string };

const IMAGE_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// A sheet's filled cells only, one row a line ("A | B | 3"): as CSV a blank FORM ANUGERAH sheet is
// ~36,000 commas, and the sheets with the order got cut off (ORD-0203: "the file is a blank template")
function sheetText(ws: XLSX.WorkSheet) {
  return (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }) as unknown[][])
    .map((r) => r.map((v) => String(v).trim()).filter(Boolean).join(' | '))
    .filter(Boolean)
    .join('\n');
}

export function readFile(bytes: Uint8Array, fileName: string): FileContent | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(bytes) } };
  if (IMAGE_TYPES[ext]) return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: encodeBase64(bytes) } };
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(bytes, { type: 'array' });
    const text = wb.SheetNames
      .filter((n) => wb.Workbook?.Sheets?.find((s: { name: string; Hidden?: number }) => s.name === n)?.Hidden !== 1)
      .map((n) => `=== Sheet: ${n} ===\n${sheetText(wb.Sheets[n])}`)
      .join('\n\n');
    return { type: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  if (ext === 'docx') {
    const xml = strFromU8(unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml']);
    // line breaks inside a paragraph kept, a table row's cells side by side ("(1PKB ALFA)TERBAIK PBD…"
    // ran together, SK JUGRA 2026-11-06)
    const text = xml.replace(/<w:(?:br|cr)\b[^>]*\/>/g, '\n').replace(/<\/w:p>\s*<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/^[\s|]+$/gm, '').replace(/\n{2,}/g, '\n'); // rows of empty cells
    return { type: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  return null;
}
