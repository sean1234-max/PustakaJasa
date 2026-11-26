// Launcher for the AI File helper (helper v9, Sean 2026-11-26: "我这里 update 后，公司同事的电脑也跟着 update").
// The login item (Windows) / LaunchAgent (Mac) runs THIS file. It starts ai-file-helper.mjs as a child,
// starts it again if it quits, and pulls newer helper versions from the NAS by itself:
//   - at start and every 10 min it reads `const VERSION = n` in <AI FILE>/ai-file-helper/ai-file-helper.mjs;
//   - newer than the one here -> that folder's .mjs/.jsx are copied into next/ and loaded once in a separate
//     node (a half-copied or broken version is skipped and tried again next round); then it waits until no
//     Illustrator job is queued or running, stops the helper, keeps the current files in previous/, puts
//     next/ in place and starts the helper again;
//   - a new version that quits within 30 s of starting is rolled back to previous/ and written into
//     bad-versions.txt, so it is never tried again (the next version number is).
// An update never replaces this file (only the installer does), so keep it small. Node built-ins only.
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { readFile, readdir, copyFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAIN = 'ai-file-helper.mjs';
const NEXT_DIR = path.join(HELPER_DIR, 'next');
const PREVIOUS_DIR = path.join(HELPER_DIR, 'previous');
const BAD_FILE = path.join(HELPER_DIR, 'bad-versions.txt');
// AI_HELPER_PORT / AI_HELPER_UPDATE_MS: only for trying a copy beside the installed helper
const PORT = Number(process.env.AI_HELPER_PORT) || 47821;
const UPDATE_CHECK_MS = Number(process.env.AI_HELPER_UPDATE_MS) || 10 * 60 * 1000;
const BUSY_RECHECK_MS = 30 * 1000;
const STATUS_TIMEOUT_MS = 15 * 1000;
const LOAD_CHECK_TIMEOUT_MS = 60 * 1000;
const CRASH_WINDOW_MS = 30 * 1000;
const RESTART_DELAY_MS = 5 * 1000;
const CRASH_RESTART_DELAY_MS = 60 * 1000;
const STATUS_ORIGIN = 'https://pustaka-jasa.vercel.app';

const log = (msg) => console.log(`[${new Date().toISOString()}] [launcher] ${msg}`);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Same rule as resolveAiFileDir in ai-file-helper.mjs — copied, not imported, so a broken helper
// version can never break the launcher that has to roll it back.
function aiFileDir() {
  if (process.env.AI_FILE_DIR) return process.env.AI_FILE_DIR;
  try {
    const line = readFileSync(path.join(HELPER_DIR, 'ai-file-dir.txt'), 'utf8').trim();
    if (line) return line;
  } catch { /* no override on this computer */ }
  return process.platform === 'win32'
    ? '\\\\TEQGO\\Artwork\\D O U B L E  W I N\\#LOGO CUT\\(EXCELL) MIMAKI CUTTING PLOT'
    : '/Volumes/Artwork/D O U B L E  W I N/#LOGO CUT/(EXCELL) MIMAKI CUTTING PLOT';
}

export function parseHelperVersion(text) {
  const m = String(text || '').match(/^const VERSION = (\d+);/m);
  return m ? Number(m[1]) : 0;
}

// What an update copies: the helper's modules and Illustrator scripts — not tests, not this launcher,
// not macOS "._" files the NAS keeps next to them, not the installed .bak copies.
export function isHelperFile(name) {
  return /\.(mjs|jsx)$/i.test(name) && !name.startsWith('.') && !/\.test\.mjs$/i.test(name) && name !== 'launcher.mjs';
}

export const shouldUpdate = (nasVersion, localVersion, badVersions) =>
  nasVersion > localVersion && !badVersions.has(nasVersion);

async function readVersion(file) {
  try { return parseHelperVersion(await readFile(file, 'utf8')); } catch { return 0; }
}

export async function copyHelperFiles(fromDir, toDir) {
  await mkdir(toDir, { recursive: true });
  const names = (await readdir(fromDir)).filter(isHelperFile);
  for (const name of names) await copyFile(path.join(fromDir, name), path.join(toDir, name));
  return names;
}

// '' when <dir>/ai-file-helper.mjs and everything it imports load (syntax + every import resolves),
// else the first lines of the error. Importing it doesn't start its server (that needs it as argv[1]).
export function loadError(dir) {
  const url = pathToFileURL(path.join(dir, MAIN)).href;
  return new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', url],
      { timeout: LOAD_CHECK_TIMEOUT_MS, windowsHide: true },
      (err, _out, stderr) => resolve(err ? (String(stderr).trim().split(/\r?\n/).slice(0, 4).join(' | ') || err.message) : ''));
  });
}

async function readBadVersions() {
  try { return new Set((await readFile(BAD_FILE, 'utf8')).split(/\s+/).filter(Boolean).map(Number)); } catch { return new Set(); }
}

// The running helper's own answer. No answer (still starting, hung) counts as busy: better to update late
// than in the middle of a job. A helper that never answers gets the update at the next login.
function helperBusy() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/status', headers: { Origin: STATUS_ORIGIN }, timeout: STATUS_TIMEOUT_MS }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(body).busy !== false); } catch { resolve(true); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(true));
  });
}

let helper = null;
let updating = false;

// updatedTo: the version just installed — if it quits within CRASH_WINDOW_MS it is rolled back.
function startHelper(updatedTo = 0) {
  if (helper) return;
  const startedAt = Date.now();
  const child = spawn(process.execPath, [path.join(HELPER_DIR, MAIN)], { stdio: 'inherit', windowsHide: true });
  helper = child;
  child.on('error', (err) => log(`helper: ${err.message}`));
  child.on('exit', (code, signal) => {
    if (helper === child) helper = null;
    if (child.stoppedOnPurpose) return;
    const quick = Date.now() - startedAt < CRASH_WINDOW_MS;
    log(`helper quit (code ${code}${signal ? `, ${signal}` : ''})${quick ? ' right after starting' : ''}`);
    if (quick && updatedTo) {
      rollBack(updatedTo).then(() => startHelper());
      return;
    }
    setTimeout(() => startHelper(), quick ? CRASH_RESTART_DELAY_MS : RESTART_DELAY_MS);
  });
}

async function stopHelper() {
  const child = helper;
  if (!child) return;
  child.stoppedOnPurpose = true;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
  if (helper === child) helper = null;
}

async function rollBack(version) {
  log(`v${version} quit right after starting — putting the previous version back; v${version} won't be tried again`);
  try {
    await appendFile(BAD_FILE, `${version}\n`);
    await copyHelperFiles(PREVIOUS_DIR, HELPER_DIR);
  } catch (err) {
    log(`roll back failed: ${err.message}`);
  }
}

async function checkForUpdate() {
  if (updating) return;
  updating = true;
  try {
    const source = path.join(aiFileDir(), 'ai-file-helper');
    const nasVersion = await readVersion(path.join(source, MAIN));
    const localVersion = await readVersion(path.join(HELPER_DIR, MAIN));
    if (!shouldUpdate(nasVersion, localVersion, await readBadVersions())) return;
    log(`NAS has helper v${nasVersion}, this computer v${localVersion} — updating`);
    await rm(NEXT_DIR, { recursive: true, force: true });
    await copyHelperFiles(source, NEXT_DIR);
    const problem = await loadError(NEXT_DIR);
    if (problem) {
      log(`v${nasVersion} doesn't load, not installed (tried again at the next check): ${problem}`);
      return;
    }
    let saidWaiting = false;
    while (helper && await helperBusy()) {
      if (!saidWaiting) log('helper is busy — waiting for the job to finish');
      saidWaiting = true;
      await sleep(BUSY_RECHECK_MS);
    }
    // ponytail: a job clicked in the few ms between this check and the stop is lost; the page shows an error
    await stopHelper();
    await rm(PREVIOUS_DIR, { recursive: true, force: true });
    await copyHelperFiles(HELPER_DIR, PREVIOUS_DIR);
    await copyHelperFiles(NEXT_DIR, HELPER_DIR);
    log(`helper v${nasVersion} installed (v${localVersion} kept in previous/)`);
    startHelper(nasVersion);
  } catch (err) {
    log(`update check failed: ${err.message}`);
  } finally {
    updating = false;
  }
}

async function main() {
  log(`started (${HELPER_DIR}), checks ${path.join(aiFileDir(), 'ai-file-helper')} for updates`);
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => { stopHelper().finally(() => process.exit(0)); });
  }
  await checkForUpdate();
  startHelper();
  setInterval(checkForUpdate, UPDATE_CHECK_MS);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
