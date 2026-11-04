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

export function readFile(bytes: Uint8Array, fileName: string): FileContent | null {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: encodeBase64(bytes) } };
  if (IMAGE_TYPES[ext]) return { type: 'image', source: { type: 'base64', media_type: IMAGE_TYPES[ext], data: encodeBase64(bytes) } };
  if (ext === 'xlsx' || ext === 'xls') {
    const wb = XLSX.read(bytes, { type: 'array' });
    const text = wb.SheetNames
      .filter((n) => wb.Workbook?.Sheets?.find((s: { name: string; Hidden?: number }) => s.name === n)?.Hidden !== 1)
      .map((n) => `=== Sheet: ${n} ===\n${XLSX.utils.sheet_to_csv(wb.Sheets[n], { blankrows: false })}`)
      .join('\n\n');
    return { type: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  if (ext === 'docx') {
    const xml = strFromU8(unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })['word/document.xml']);
    const text = xml.replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return { type: 'text', text: text.slice(0, MAX_TEXT_CHARS) };
  }
  return null;
}
