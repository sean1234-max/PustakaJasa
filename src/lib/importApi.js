import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { supabase } from './supabaseClient';

// Client side of the AI order-file extraction (Phase 4, Batch E). The
// deterministic parsers (excelImport.js / docxImport.js) still run first and
// still win whenever they can — this is only the fallback path, and only
// when VITE_AI_IMPORT_ENABLED is set. See AppState.jsx importFormAnugerahExcel.

const MIME_BY_EXT = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Flattens a workbook to compact plain text the model can read: one block
// per sheet, blank rows/cells dropped, cells joined with " | ". This is
// what's sent to the Edge Function — the raw bytes never leave for the
// model, only this rendering.
function renderXlsxText(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' });
  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
    const body = rows
      .map((r) => r.map((c) => String(c).replace(/\s+/g, ' ').trim()).join(' | ').replace(/(\s*\|\s*)+$/, ''))
      .filter((line) => line.replace(/[|\s]/g, '') !== '')
      .join('\n');
    return `SHEET: ${name}\n${body}`;
  }).join('\n\n');
}

// Word docs: pull every paragraph's text, tab-separate table cells, newline
// between paragraphs/rows. Crude tag-stripping is enough — the model only
// needs the words and their rough layout.
async function renderDocxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) return '';
  return xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.replace(/\s*\|\s*$/, '').trimEnd()).filter((l) => l.trim() !== '')
    .join('\n');
}

export async function renderSheetsText(buffer, fileName) {
  return /\.docx$/i.test(fileName) ? renderDocxText(buffer) : renderXlsxText(buffer);
}

// Uploads the raw file to the private order-imports bucket for the audit
// trail (order-imports/<uid>/<sha256>.<ext>). Best-effort — a failure here
// doesn't stop the extraction, which works off the text rendering.
export async function uploadOrderFile(file, buffer) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not signed in');
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  const hash = await sha256Hex(buffer);
  const path = `${user.id}/${hash}${ext}`;
  const { error } = await supabase.storage.from('order-imports').upload(path, file, {
    contentType: MIME_BY_EXT[ext] || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw error;
  return { storagePath: path };
}

// Calls the extract-order-file Edge Function. Returns its JSON body
// ({ runId, status, result? , error? }) or throws.
export async function runAiExtraction({ storagePath, fileName, sheetsText }) {
  const { data, error } = await supabase.functions.invoke('extract-order-file', {
    body: { storagePath, fileName, sheetsText },
  });
  if (error) {
    // functions.invoke wraps a non-2xx as an error with the body on .context
    let body = null;
    try { body = await error.context?.json?.(); } catch { /* ignore */ }
    return body || { status: 'failed', error: error.message };
  }
  return data;
}
