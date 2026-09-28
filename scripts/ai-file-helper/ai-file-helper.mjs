// "AI File helper" — runs in the background on every computer that should be
// able to generate AI files from the Production order page's "Generate AI
// File" button. A web page can't check local folders or start Illustrator
// itself (browser sandbox), so the page talks to this over loopback instead:
//   GET  /status    -> is this computer's AI FILE folder (SEAN.jsx) reachable?
//   POST /generate  -> { filename, csv } -> queue a SEAN.jsx run, returns jobId
//   GET  /jobs/:id  -> that run's status/result
// The job runs on THIS computer, the one whose browser clicked the button.
// No Supabase access and no secrets — the page sends the CSV itself. Node
// built-ins only, so install is just "have Node.js, run the installer".
import http from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);

export const PORT = 47821;
const VERSION = 1;
const HELPER_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(tmpdir(), 'pustakajasa-ai-helper');
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// The shared NAS folder that holds SEAN.jsx, the template .ai files and
// OUTPUT/. Windows reaches it by UNC path; a Mac mounts the same share
// (Finder > Go > Connect to Server > smb://TEQGO/Artwork) under /Volumes.
const DEFAULT_AI_FILE_DIR = process.platform === 'win32'
  ? '\\\\TEQGO\\Artwork\\D O U B L E  W I N\\#LOGO CUT\\(EXCELL) MIMAKI CUTTING PLOT'
  : '/Volumes/Artwork/D O U B L E  W I N/#LOGO CUT/(EXCELL) MIMAKI CUTTING PLOT';

// Per-computer override without reinstalling: an ai-file-dir.txt next to
// this script (one line, the path), or the AI_FILE_DIR env var. Re-read on
// every request so fixing the path takes effect immediately.
function resolveAiFileDir() {
  if (process.env.AI_FILE_DIR) return process.env.AI_FILE_DIR;
  const overrideFile = path.join(HELPER_DIR, 'ai-file-dir.txt');
  if (existsSync(overrideFile)) {
    const line = readFileSync(overrideFile, 'utf8').trim();
    if (line) return line;
  }
  return DEFAULT_AI_FILE_DIR;
}

const ALLOWED_ORIGINS = new Set([
  'https://pustaka-jasa.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.HELPER_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
]);

// Only the School Portal itself may drive this. A browser always sends
// Origin on a cross-origin request, so any other website is refused; the
// Host check additionally blocks DNS-rebinding (a hostile domain re-pointed
// at 127.0.0.1 would arrive with its own Host header).
export function isAllowedRequest(headers, allowedOrigins = ALLOWED_ORIGINS) {
  const host = String(headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) return false;
  return allowedOrigins.has(headers.origin || '');
}

// Same rule SEAN.jsx applies to the CSV's base name when it picks
// OUTPUT/<folder> — must match so we look where SEAN.jsx just wrote.
export function sanitizeFolderName(name) {
  const s = String(name).replace(/[\\/:*?"<>|%]/g, '_').trim().replace(/[. ]+$/, '');
  return s === '' ? 'UNNAMED' : s;
}

// A missing UNC path can hang for tens of seconds on Windows before the OS
// gives up — cap the check so the page gets an answer quickly.
async function folderReachable(aiFileDir) {
  const timeout = new Promise((resolve) => setTimeout(() => resolve(false), 5000));
  const check = access(path.join(aiFileDir, 'SEAN.jsx')).then(() => true, () => false);
  return Promise.race([check, timeout]);
}

// The PRESET_* injection SEAN.jsx expects. JSON.stringify produces a safely
// escaped JS string literal. PRESET_OPERATOR_NAME is deliberately left out:
// the person at this computer answers Illustrator's own "your name" popup.
function buildFullScript(aiFileDir, csvPath, logFileName) {
  return [
    `var PRESET_CSV_PATH = ${JSON.stringify(csvPath)};`,
    `var PRESET_TEMPLATE_FOLDER_PATH = ${JSON.stringify(aiFileDir)};`,
    `var PRESET_LOG_FILE_NAME = ${JSON.stringify(logFileName)};`,
    '',
    readFileSync(path.join(aiFileDir, 'SEAN.jsx'), 'utf8'),
  ].join('\n');
}

function asQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// macOS: AppleScript `do javascript`. Launches Illustrator if needed. The
// explicit timeout matters: an AppleEvent otherwise gives up after 2
// minutes, and a big order plus the name popup can take longer than that.
// ponytail: fixed 8s grace period after a cold launch; bump it if a slow
// machine still races Illustrator's startup.
async function runOnMac(scriptPath) {
  const appleScriptPath = scriptPath.replace(/\.jsx$/, '.applescript');
  writeFileSync(appleScriptPath, [
    `set scriptPath to ${asQuote(scriptPath)}`,
    'set scriptCode to read (POSIX file scriptPath) as «class utf8»',
    'with timeout of 3600 seconds',
    '  tell application id "com.adobe.illustrator"',
    '    if it is not running then',
    '      launch',
    '      delay 8',
    '    end if',
    '    activate',
    '    do javascript scriptCode',
    '  end tell',
    'end timeout',
  ].join('\n'), 'utf8');
  await execFileAsync('osascript', [appleScriptPath], { maxBuffer: 10 * 1024 * 1024 });
}

// Windows: Illustrator's COM automation. Creating the COM object launches
// Illustrator if it isn't running. DoJavaScript takes the script as a
// string, which keeps SEAN.jsx's Chinese text intact (a file handed to
// ExtendScript without a BOM would be read in the system codepage).
// ponytail: unverified against a real Windows Illustrator install; the
// ProgID/timing may need adjusting against the first real error output.
async function runOnWindows(scriptPath) {
  const psPath = scriptPath.replace(/\.jsx$/, '.ps1');
  writeFileSync(psPath, [
    '$ErrorActionPreference = "Stop"',
    `$code = Get-Content -LiteralPath ${asQuote(scriptPath)} -Raw -Encoding UTF8`,
    '$illustrator = New-Object -ComObject Illustrator.Application',
    'Start-Sleep -Seconds 3',
    '$illustrator.DoJavaScript($code) | Out-Null',
  ].join('\r\n'), 'utf8');
  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], { maxBuffer: 10 * 1024 * 1024 });
}

function listAiFilesWithMtime(folder) {
  const out = new Map();
  if (!existsSync(folder)) return out;
  for (const name of readdirSync(folder)) {
    if (/\.ai$/i.test(name)) out.set(name, statSync(path.join(folder, name)).mtimeMs);
  }
  return out;
}

function openFolder(folder) {
  if (!existsSync(folder)) return;
  const cmd = process.platform === 'win32' ? 'explorer.exe' : 'open';
  spawn(cmd, [folder], { detached: true, stdio: 'ignore' }).unref();
}

const jobs = new Map();
let queue = Promise.resolve();

async function runJob(job, filename, csv) {
  job.status = 'running';
  const aiFileDir = resolveAiFileDir();
  const outputRoot = path.join(aiFileDir, 'OUTPUT');
  const base = sanitizeFolderName(path.basename(filename).replace(/\.[^.]*$/, ''));
  const outputFolder = path.join(outputRoot, base);
  const logFileName = `last_run_log_${job.id}.txt`;
  const logPath = path.join(outputRoot, logFileName);
  job.outputFolder = outputFolder;
  try {
    if (!(await folderReachable(aiFileDir))) throw new Error(`This computer can't reach ${aiFileDir}`);
    mkdirSync(TEMP_DIR, { recursive: true });
    const csvPath = path.join(TEMP_DIR, `${base}.csv`);
    writeFileSync(csvPath, csv, 'utf8');
    const scriptPath = path.join(TEMP_DIR, `${job.id}.jsx`);
    writeFileSync(scriptPath, buildFullScript(aiFileDir, csvPath, logFileName), 'utf8');
    const before = listAiFilesWithMtime(outputFolder);
    rmSync(logPath, { force: true });
    await runIllustrator(scriptPath);
    const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(Illustrator ran, but no log file was written.)';
    const after = listAiFilesWithMtime(outputFolder);
    job.files = [...after].filter(([name, mtime]) => before.get(name) !== mtime).map(([name]) => name);
    job.message = log;
    job.status = /Cancelled|失败: /.test(log) && !/存成:/.test(log) ? 'error' : 'done';
    if (job.status === 'done') openFolder(outputFolder);
  } catch (err) {
    job.status = 'error';
    job.message = err.stderr ? `Illustrator call failed: ${err.stderr.toString()}` : err.message;
  } finally {
    rmSync(logPath, { force: true });
  }
  console.log(`[${new Date().toISOString()}] ${filename} -> ${job.status} (${job.files.length} file(s))`);
}

function runIllustrator(scriptPath) {
  return process.platform === 'win32' ? runOnWindows(scriptPath) : runOnMac(scriptPath);
}

// One Illustrator run at a time — a second click just waits its turn.
function startJob(filename, csv) {
  const job = { id: randomUUID(), status: 'queued', message: '', outputFolder: '', files: [] };
  jobs.set(job.id, job);
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value);
  queue = queue.then(() => runJob(job, filename, csv));
  return job;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (!isAllowedRequest(req.headers)) { res.writeHead(403); res.end(); return; }
    const headers = {
      'Access-Control-Allow-Origin': req.headers.origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Chrome's older Private Network Access preflight; harmless elsewhere.
      'Access-Control-Allow-Private-Network': 'true',
    };
    const send = (code, body) => {
      res.writeHead(code, { ...headers, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, headers); res.end(); return; }
    const { pathname } = new URL(req.url, `http://127.0.0.1:${PORT}`);
    try {
      if (req.method === 'GET' && pathname === '/status') {
        const aiFileDir = resolveAiFileDir();
        send(200, { ok: true, version: VERSION, platform: process.platform, aiFileDir, nasOk: await folderReachable(aiFileDir) });
        return;
      }
      if (req.method === 'POST' && pathname === '/generate') {
        const body = JSON.parse(await readBody(req));
        if (typeof body.filename !== 'string' || typeof body.csv !== 'string' || !body.csv) {
          send(400, { error: 'filename and csv are required' });
          return;
        }
        send(202, { jobId: startJob(body.filename, body.csv).id });
        return;
      }
      const match = pathname.match(/^\/jobs\/([\w-]+)$/);
      if (req.method === 'GET' && match) {
        const job = jobs.get(match[1]);
        if (job) send(200, job); else send(404, { error: 'Unknown job' });
        return;
      }
      send(404, { error: 'Not found' });
    } catch (err) {
      send(500, { error: err.message });
    }
  });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — the helper is probably already running.` : err);
    process.exit(1);
  });
  server.listen(PORT, '127.0.0.1', async () => {
    const aiFileDir = resolveAiFileDir();
    console.log(`[${new Date().toISOString()}] AI File helper listening on http://127.0.0.1:${PORT}`);
    console.log(`AI FILE folder: ${aiFileDir} (${(await folderReachable(aiFileDir)) ? 'found' : 'NOT found'})`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
