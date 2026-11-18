#!/usr/bin/env node
// Plak preview export (Sean, 2026-11-02): node scripts/plak-preview/export-plak-preview.mjs [AI FILE folder]
// Copies the folder's .ai templates to a temporary folder (Illustrator never opens the real ones),
// runs export-plak-preview.jsx on the copies, then writes public/plak-preview/: templates.json (+ the
// folder's product_mapping.csv as `mapping`, so the website picks the same .ai as SEAN.jsx) and one PNG
// per .ai. Run it again after a template .ai changes or one is added, then push.
// --only "E CUT 5" (repeatable): export just the .ai files whose name has that text and keep every other
// file's entry in the current templates.json (a file being edited on the NAS stays as it was exported).
// Illustrator must be open and not generating (the run opens and closes each copy, ~10 s per file).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const NAS = '/Volumes/Artwork/D O U B L E  W I N/#LOGO CUT/(EXCELL) MIMAKI CUTTING PLOT';
const args = process.argv.slice(2);
const only = args.filter((a) => a.startsWith('--only=')).map((a) => a.slice('--only='.length).toUpperCase());
const src = args.find((a) => !a.startsWith('--')) || NAS;
const out = path.join(here, '../../public/plak-preview');
const ILLUSTRATOR_TIMEOUT_S = 3600;

if (!existsSync(src)) throw new Error(`Can't reach ${src}`);
const work = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'plak-preview-'));
const copies = path.join(work, 'ai');
const pngs = path.join(work, 'out');
mkdirSync(copies);
const aiFiles = readdirSync(src).filter((n) => /\.ai$/i.test(n) && !/backup|OUTPUT/i.test(n)
  && (!only.length || only.some((o) => n.toUpperCase().includes(o))));
if (!aiFiles.length) throw new Error(`No .ai file in ${src} matches ${only.join(', ')}`);
aiFiles.forEach((n) => copyFileSync(path.join(src, n), path.join(copies, n)));
console.log(`Copied ${aiFiles.length} .ai file(s) from ${src}`);

const jsx = path.join(work, 'run.jsx');
writeFileSync(jsx, [
  `var PRESET_SRC = ${JSON.stringify(copies)};`,
  `var PRESET_OUT = ${JSON.stringify(pngs)};`,
  readFileSync(path.join(here, 'export-plak-preview.jsx'), 'utf8'),
].join('\n'));
execFileSync('osascript', [
  '-e', `with timeout of ${ILLUSTRATOR_TIMEOUT_S} seconds`,
  '-e', `tell application "Adobe Illustrator" to do javascript (read POSIX file ${JSON.stringify(jsx)} as «class utf8»)`,
  '-e', 'end timeout',
], { stdio: 'inherit' });

const exported = JSON.parse(readFileSync(path.join(pngs, 'templates.json'), 'utf8'));
console.log(readFileSync(path.join(pngs, 'export-log.txt'), 'utf8'));

// product_mapping.csv rows as [code, file] (quoted cells, like SEAN.jsx parseCSVLine)
const cells = (line) => {
  const res = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { res.push(cur); cur = ''; } else cur += ch;
  }
  return [...res, cur];
};
const mappingPath = path.join(src, 'product_mapping.csv');
const mapping = existsSync(mappingPath)
  ? readFileSync(mappingPath, 'utf8').replace(/^﻿/, '').split(/\r?\n/).slice(1)
    .map((l) => cells(l).map((c) => c.trim())).filter(([code, file]) => code && file)
  : [];

// --only: the other files' entries (and their pictures) as they are; the re-exported files' old pictures go
const manifestPath = path.join(out, 'templates.json');
const kept = only.length ? JSON.parse(readFileSync(manifestPath, 'utf8')).files.filter((f) => !aiFiles.includes(f.file)) : [];
const pngsOf = (files) => new Set(files.flatMap((f) => [f.picture.png, ...Object.values(f.templates).map((t) => t.art?.png)]).filter(Boolean));
if (only.length) {
  const keptPngs = pngsOf(kept);
  readdirSync(out).filter((n) => n.endsWith('.png') && !keptPngs.has(n)).forEach((n) => rmSync(path.join(out, n)));
} else {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
}
exported.files.forEach((f) => copyFileSync(path.join(pngs, f.picture.png), path.join(out, f.picture.png)));
// each layout group's own artwork: the same picture (most groups of a file share one frame) kept once
const byHash = new Map([...pngsOf(kept)].map((n) => [createHash('sha1').update(readFileSync(path.join(out, n))).digest('hex'), n]));
exported.files.forEach((f) => Object.values(f.templates).forEach((t) => {
  if (!t.art) return;
  const hash = createHash('sha1').update(readFileSync(path.join(pngs, t.art.png))).digest('hex');
  if (!byHash.has(hash)) {
    byHash.set(hash, t.art.png);
    copyFileSync(path.join(pngs, t.art.png), path.join(out, t.art.png));
  }
  t.art.png = byHash.get(hash);
}));
const files = [...kept, ...exported.files].sort((a, b) => a.file.localeCompare(b.file));
writeFileSync(manifestPath, `${JSON.stringify({ exportedAt: new Date().toISOString(), mapping, files })}\n`);
rmSync(work, { recursive: true, force: true });
console.log(`Wrote ${exported.files.length} file(s) (${kept.length} kept as they were) and ${byHash.size} artwork picture(s) to ${out}`);
