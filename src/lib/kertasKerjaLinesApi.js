import { supabase } from './supabaseClient';
import { kertasKerjaLines } from '../utils/kertasKerjaText';
import { loadPdfjs } from '../utils/pdfImport';

// The salesman's own kertas kerja as printed lines (kertasKerjaText.js — no AI), for Add to Cart's check
// (Sean, 2026-11-26). Read from the uploaded File when it was just uploaded, else downloaded from
// order-imports; once per page load. The form bot's copies (form-bot/…) are skipped — their reading is used
// (formFillApi.js). null = nothing to check against (a scan, a photo, a download that failed).
const cache = new Map();
const READ_TIMEOUT_MS = 15000;
const timeout = (ms) => new Promise((_, reject) => { setTimeout(() => reject(new Error('reading the kertas kerja timed out')), ms); });

const read = async (buffer, name) => kertasKerjaLines(buffer, name, /\.pdf$/i.test(name) ? { pdfjs: await loadPdfjs() } : {});

function remember(path, work) {
  const p = Promise.race([work, timeout(READ_TIMEOUT_MS)]).catch((err) => {
    console.error('kertas kerja lines failed:', err);
    cache.delete(path);
    return null;
  });
  cache.set(path, p);
  return p;
}

// Right after upload (KertasKerjaUpload): read from the File itself
export function readUploadedKertasKerja(path, file) {
  return remember(path, file.arrayBuffer().then((b) => read(b, file.name)));
}

export function linesOfKertasKerja(file) {
  if (!file?.path || file.path.startsWith('form-bot/')) return Promise.resolve(null);
  if (cache.has(file.path)) return cache.get(file.path);
  return remember(file.path, (async () => {
    const { data, error } = await supabase.storage.from('order-imports').download(file.path);
    if (error) throw error;
    return read(await data.arrayBuffer(), file.name);
  })());
}

export async function linesOfAll(files) {
  return (await Promise.all((files || []).map(linesOfKertasKerja))).filter(Boolean).flat();
}
