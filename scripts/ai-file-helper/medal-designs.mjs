// Medal designs (Sean, 2026-11-24): the website's MEDAL DESIGNS page asks the helper to read every
// "DESIGN <n>" group of E CUT 0 — its layout groups, background and a picture of how it looks — with
// export-plak-preview.jsx's design mode, on a COPY of the .ai (the real one is never opened). The page
// then stores the result in Supabase itself; the helper still holds no secrets.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MEDAL_DESIGN_FILE = 'E CUT 0 - MEDAL (SUKAN) -SALES.ai';
const EXPORT_JSX = 'export-plak-preview.jsx';
const MAX_PICTURE_BYTES = 5 * 1024 * 1024;

// installed: next to the helper; run from the repo: scripts/plak-preview/
export function findExportJsx(helperDir) {
  const found = [path.join(helperDir, EXPORT_JSX), path.join(helperDir, '..', 'plak-preview', EXPORT_JSX)].find((p) => existsSync(p));
  if (!found) throw new Error(`${EXPORT_JSX} is missing next to the AI File helper — run the helper's installer again`);
  return found;
}

// -> the .jsx Illustrator runs: E CUT 0 copied into workDir, the export's results into workDir/out
export function writeDesignScript(aiFileDir, workDir, exportJsxPath) {
  const source = path.join(aiFileDir, MEDAL_DESIGN_FILE);
  if (!existsSync(source)) throw new Error(`No ${MEDAL_DESIGN_FILE} in ${aiFileDir}`);
  mkdirSync(path.join(workDir, 'out'), { recursive: true });
  const copy = path.join(workDir, MEDAL_DESIGN_FILE);
  copyFileSync(source, copy);
  const script = path.join(workDir, 'medal-designs.jsx');
  writeFileSync(script, [
    `var PRESET_DESIGN_FILE = ${JSON.stringify(copy)};`,
    `var PRESET_OUT = ${JSON.stringify(path.join(workDir, 'out'))};`,
    readFileSync(exportJsxPath, 'utf8'),
  ].join('\n'), 'utf8');
  return script;
}

const pngNamesOf = (design) => [
  design.thumb,
  design.picture?.png,
  ...Object.values(design.templates || {}).map((t) => t.art?.png),
].filter(Boolean);

// designs.json + export-log.txt + the PNGs they name (base64) -> { designs, log, pictures }.
// A design whose picture is missing is dropped and said so in the log.
export function readDesignExport(outDir) {
  const log = existsSync(path.join(outDir, 'export-log.txt'))
    ? readFileSync(path.join(outDir, 'export-log.txt'), 'utf8').split(/\r\n|\r|\n/).filter(Boolean)
    : [];
  const manifest = path.join(outDir, 'designs.json');
  if (!existsSync(manifest)) return { designs: [], log: [...log, 'Illustrator wrote no designs.json'], pictures: {} };
  const pictures = {};
  const designs = (JSON.parse(readFileSync(manifest, 'utf8')).designs || []).filter((d) => {
    const names = pngNamesOf(d);
    const missing = names.filter((n) => !existsSync(path.join(outDir, n)));
    if (missing.length) { log.push(`${d.design}: FAILED picture(s) missing: ${missing.join(', ')}`); return false; }
    const big = names.find((n) => readFileSync(path.join(outDir, n)).length > MAX_PICTURE_BYTES);
    if (big) { log.push(`${d.design}: FAILED ${big} is over 5 MB`); return false; }
    names.forEach((n) => { pictures[n] = readFileSync(path.join(outDir, n)).toString('base64'); });
    return true;
  });
  return { designs, log, pictures };
}
