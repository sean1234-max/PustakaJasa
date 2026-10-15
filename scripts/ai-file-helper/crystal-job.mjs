// Crystals -> Illustrator, for the AI File helper (Sean, 2026-10-14: crystal Stage 4, in place of
// the colleague's separate "Crystal Studio" program). The website's Crystal Preview / Crystal
// Studio send a job made by public/crystal/js/vector-job.js: each crystal made from the original
// .ai it was imported from (kept in our Supabase "crystal" bucket), its words as editable text.
// This file checks the job, downloads those originals and writes the Illustrator script
// (crystal-illustrator.mjs = a copy of public/crystal/js/illustrator.js, kept identical by a test).
import { writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { illustratorScript } from './crystal-illustrator.mjs';

// Only our own project's copies of the imported .ai files.
const ORIGINAL_URL = /^https:\/\/dlzkdkxbnbhgldsvbybt\.supabase\.co\/storage\/v1\/object\/public\/crystal\/library\/orig-[a-z0-9-]+\.pdf$/;
const ORIGINAL_PATH = /^library\/orig-[a-z0-9-]+\.pdf$/;
const PLATFORM_KEYS = ['w', 'h', 'left', 'right', 'top', 'bottom', 'gapX', 'gapY'];
const MAX_ROWS = 300;

export const isOurOriginalUrl = (url) => typeof url === 'string' && ORIGINAL_URL.test(url);

// Windows / macOS folder-name safe, like the colleague's server.js
export const cleanName = (s, n) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n).replace(/[. ]+$/, '');

// <OUTPUT>/CRYSTAL/<date time> - <school (order)>, in Malaysia time
export function crystalOutDir(outputRoot, label, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const stamp = `${p.year}-${p.month}-${p.day} ${p.hour}-${p.minute}-${p.second}`;
  const tag = cleanName(label, 80);
  return path.join(outputRoot, 'CRYSTAL', tag ? `${stamp} - ${tag}` : stamp);
}

// The job as sent by the page -> checked: rows (crystals from their original .ai) and/or svg
// files (a design without one). Throws with a message the page shows.
export function checkCrystalJob(body) {
  const job = body && typeof body.job === 'object' && body.job ? body.job : {};
  const rows = Array.isArray(job.rows) ? job.rows : [];
  const files = (Array.isArray(body?.files) ? body.files : [])
    .filter((f) => f && typeof f.name === 'string' && typeof f.svg === 'string' && /^\s*(<\?xml|<svg)/.test(f.svg));
  if (!rows.length && !files.length) throw new Error('Nothing to make.');
  if (rows.length > MAX_ROWS) throw new Error(`Too many crystals in one go (${rows.length}; at most ${MAX_ROWS}).`);
  for (const r of rows) {
    if (!r || typeof r.file !== 'string' || /[\\/]/.test(r.file)) throw new Error('Bad template name.');
    if (!isOurOriginalUrl(r.originalUrl) || !ORIGINAL_PATH.test(String(r.original || ''))) throw new Error(`No copy of the .ai for ${r.name || r.file} is kept online — import it again in Crystal Studio.`);
  }
  const P = job.platform && typeof job.platform === 'object' ? job.platform : null;
  const platform = P && PLATFORM_KEYS.every((k) => Number.isFinite(+P[k]) && +P[k] >= 0)
    ? Object.fromEntries(PLATFORM_KEYS.map((k) => [k, +P[k]])) : null;
  // folder: the plaques' own OUTPUT folder name (Generate AI File — Sean, 2026-10-15), or none
  return { rows, files, platform, label: cleanName(job.label, 80), folder: cleanName(job.folder, 120) };
}

// A file from our storage -> dest. Node first; on Windows, if Node can't connect (an antivirus or
// company network inspecting HTTPS with its own certificate), Windows' own downloader.
async function download(url, dest) {
  let why;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return;
  } catch (e) {
    why = (e.cause && (e.cause.code || e.cause.message)) || e.message || String(e);
    if (/^\d{3} /.test(why) || process.platform !== 'win32') throw new Error(`download failed: ${why}`);
  }
  const ps = "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $env:CS_URL -OutFile $env:CS_DEST -UseBasicParsing -TimeoutSec 60";
  const code = await new Promise((done) => {
    const p = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore', windowsHide: true, env: { ...process.env, CS_URL: url, CS_DEST: dest } });
    p.on('error', () => done(-1));
    p.on('exit', (c) => done(c));
  });
  if (code !== 0 || !existsSync(dest) || !statSync(dest).size) {
    try { unlinkSync(dest); } catch { /* nothing there */ }
    throw new Error(`download failed (${why}; Windows couldn't download it either — is this computer online?)`);
  }
}

// Downloads the originals and pictures into workDir (a scratch folder — Sean 2026-10-14: the output
// folder gets only the .ai files), writes the Illustrator script there and returns its path. The
// .ai files go to outDir. Rows whose original can't be fetched still go (the script reports them).
// Pictures are embedded in the .ai, so workDir can be deleted afterwards.
export async function writeCrystalScript({ rows, files, platform, label, quiet = false }, outDir, workDir) {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const two = (n) => String(n).padStart(2, '0');
  const got = new Map();
  for (const r of rows) {
    delete r.path;
    if (!got.has(r.original)) {
      const dir = path.join(workDir, 'templates');
      mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${path.basename(r.original, '.pdf').replace(/^orig-/, '')} - ${r.file.replace(/\.(pdf|svg)$/i, '.ai')}`);
      let err = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await download(r.originalUrl, dest); err = null; break; } catch (e) { err = e.message; }
      }
      got.set(r.original, err ? { error: err } : dest);
    }
    const g = got.get(r.original);
    if (typeof g === 'string') r.path = g; else r.originalError = g.error;
    // pictures added in Crystal Studio: saved next to the files for Illustrator to place
    r.images = (Array.isArray(r.images) ? r.images : []).map((im, i) => {
      const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/.exec(im?.src || '');
      if (!m) return null;
      const dir = path.join(workDir, 'images');
      mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${two(r.row)}-${i + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`);
      writeFileSync(file, Buffer.from(m[2], 'base64'));
      return { path: file, l: +im.l, t: +im.t, r: +im.r, b: +im.b, w: +im.w || +im.r - +im.l, h: +im.h || +im.b - +im.t, angle: +im.angle || 0, flipX: !!im.flipX };
    }).filter(Boolean);
  }
  const pieces = rows.reduce((n, r) => n + (Math.round(+r.qty) || 1), 0);
  const job = {
    folder: '', outDir, keepOpen: rows.length <= 5, outline: false, quiet, rows,
    ...(platform && pieces > 1 ? { platform, keepOpen: true } : {}), ...(label ? { label } : {}),
  };
  const script = [rows.length ? illustratorScript(job) : '#target illustrator', svgScript(files, workDir, outDir)].join('\n');
  const scriptPath = path.join(workDir, 'make.jsx');
  writeFileSync(scriptPath, script, 'utf8');
  return scriptPath;
}

// Designs without an original .ai: the page sends them as .svg (words editable, artwork a picture);
// Illustrator opens each (from workDir) and saves it as .ai in outDir.
function svgScript(files, workDir, outDir) {
  if (!files.length) return '';
  const used = new Set();
  const paths = files.map((f) => {
    let name = cleanName(f.name, 120) || 'crystal';
    for (let k = 2; used.has(name.toLowerCase()); k++) name = name.replace(/( \(\d+\))?$/, ` (${k})`);
    used.add(name.toLowerCase());
    const p = path.join(workDir, `${name}.svg`);
    writeFileSync(p, f.svg);
    return p.replace(/\\/g, '/');
  });
  const out = outDir.replace(/\\/g, '/');
  return `
(function () {
  var files = ${JSON.stringify(paths)};
  for (var i = 0; i < files.length; i++) {
    try {
      var doc = app.open(new File(files[i]));
      doc.saveAs(new File(${JSON.stringify(out)} + "/" + files[i].replace(/^.*\\//, "").replace(/\\.svg$/i, ".ai")), new IllustratorSaveOptions());
      if (i >= 5) doc.close(SaveOptions.DONOTSAVECHANGES);
    } catch (e) {}
  }
})();
`;
}
