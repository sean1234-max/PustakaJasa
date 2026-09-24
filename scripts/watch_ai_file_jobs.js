// Local watcher for the "Generate AI File" button (Production order page,
// see src/lib/aiFileJobsApi.js + migration 0071). Polls ai_file_jobs for
// pending rows, runs SEAN.jsx against each job's CSV, then uploads
// whatever .ai files that run produced to the ai-file-outputs bucket.
//
// Cross-platform trigger: on macOS, AppleScript's `do javascript` (the
// bridge proven out manually — see "AI FILE/trigger_real_script_with_csv.
// applescript"); on Windows, the same idea via Illustrator's own COM
// automation (`Illustrator.Application`'s `.DoJavaScript()`), since
// AppleScript doesn't exist there. Both platforms run the exact same
// combined script text (buildFullScript below assembles it once, in Node,
// so there's only one place that does the PRESET_* variable injection) —
// only the "hand this text to Illustrator" step differs per OS.
// ponytail: the Windows path is unverified against a real Windows
// Illustrator install — expect to debug the exact COM ProgID/behaviour
// against real error output, the same way the macOS bridge was proven out.
//
// One watcher per machine, one machine per person (multiple staff each
// have their own copy of the template .ai files + Illustrator license) —
// WATCHER_USER_EMAIL in .env scopes this instance to only the jobs THAT
// person queued (ai_file_jobs.requested_by), so whoever clicks "Generate
// AI File" on the website has it run on their own machine, not whoever
// else's watcher happens to be running. Leave it unset for a single-
// machine setup (picks up any pending job, regardless of who queued it —
// the original, still-default behaviour).
//
// One-time setup on a new machine (see scripts/setup_watcher_autostart.sh
// on macOS — a LaunchAgent — or scripts/setup_watcher_autostart.ps1 on
// Windows — a Startup-folder entry — for the no-more-Terminal-after-this
// auto-start install):
//   node --env-file=.env scripts/watch_ai_file_jobs.js
// (needs SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, and — for a shared
// multi-person setup — WATCHER_USER_EMAIL in .env. Service role bypasses
// RLS, which is how this script is allowed to read every pending job and
// write status back; see migration 0071's policies. Get the key from the
// Supabase dashboard: Project Settings -> API -> service_role.)
//
// ponytail: single instance PER PERSON, jobs processed one at a time,
// oldest first — no locking/leasing beyond the plain claim update below.
// Safe because WATCHER_USER_EMAIL already scopes each machine to a
// disjoint set of jobs (nobody's watcher polls for someone else's jobs);
// running two unfiltered watchers on the same job pool would still race.
// ponytail: a job stuck in 'processing' (watcher crashed mid-run) needs a
// manual UPDATE back to 'pending' — no automatic recovery/retry.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const AI_FILE_DIR = process.env.AI_FILE_DIR || '/Users/seanng/Documents/Pustaka Jasa/AI FILE';
const SEAN_JSX_PATH = process.env.SEAN_JSX_PATH || `${AI_FILE_DIR}/SEAN.jsx`;
const OUTPUT_ROOT = `${AI_FILE_DIR}/OUTPUT`;
const POLL_INTERVAL_MS = 15000;
const TEMP_DIR = path.join(tmpdir(), 'ai-file-jobs');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env scripts/watch_ai_file_jobs.js');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

// Resolved once at startup below — null means "no filter, pick up any
// pending job" (single-machine setup).
let watcherUserId = null;
async function resolveWatcherUserId() {
  const email = process.env.WATCHER_USER_EMAIL;
  if (!email) return null;
  // supabase-js has no admin.getUserByEmail — list and match. Fine at this
  // app's staff-account scale; paginate (the `page` param) if that ever grows.
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) { console.error('Could not look up WATCHER_USER_EMAIL:', error.message); process.exit(1); }
  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) { console.error(`No account found for WATCHER_USER_EMAIL="${email}".`); process.exit(1); }
  return user.id;
}

// Same folder-name sanitizing rule SEAN.jsx applies to the CSV's own base
// name when it picks OUTPUT_FOLDER_PATH/<company> — must match exactly so
// this script looks in the same place SEAN.jsx just wrote to.
function sanitizeFolderName(name) {
  const s = String(name).replace(/[\\/:*?"<>|%]/g, '_').trim().replace(/[. ]+$/, '');
  return s === '' ? 'UNNAMED' : s;
}

function outputFolderFor(csvFilename) {
  const base = csvFilename.replace(/\.[^.]*$/, '');
  return path.join(OUTPUT_ROOT, sanitizeFolderName(base));
}

// One log FILE NAME per job, not the fixed "last_run_log.txt" — AI_FILE_DIR
// can now be a NAS folder shared by several machines' watchers, and two
// jobs finishing around the same time on different machines would
// otherwise overwrite/read each other's result off that one shared name.
function logFileNameFor(jobId) {
  return `last_run_log_${jobId}.txt`;
}

function asQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Builds the exact ExtendScript text Illustrator will run — the
// PRESET_CSV_PATH/PRESET_TEMPLATE_FOLDER_PATH/PRESET_LOG_FILE_NAME
// variable-injection recipe SEAN.jsx expects, same as the proven-manually
// trigger_real_script_with_csv.applescript, just assembled once here in
// Node (JSON.stringify already produces a valid, safely-escaped JS string
// literal) so both platforms' trigger step below can stay dumb — "read
// this file, hand it to Illustrator" — with no escaping logic of their own.
// PRESET_TEMPLATE_FOLDER_PATH matters even on a single-machine setup once
// AI_FILE_DIR differs from SEAN.jsx's own hardcoded default, and doubly so
// on a shared NAS path each machine can mount differently. Deliberately
// does NOT set PRESET_OPERATOR_NAME: the Illustrator "enter your name"
// popup still shows, so whoever is at the machine has to type who actually
// ran it.
function buildFullScript(csvPath, logFileName) {
  const presetLines = [
    `var PRESET_CSV_PATH = ${JSON.stringify(csvPath)};`,
    `var PRESET_TEMPLATE_FOLDER_PATH = ${JSON.stringify(AI_FILE_DIR)};`,
    `var PRESET_LOG_FILE_NAME = ${JSON.stringify(logFileName)};`,
    '',
  ].join('\n');
  return presetLines + readFileSync(SEAN_JSX_PATH, 'utf8');
}

// macOS: AppleScript's `do javascript`, same bundle-id addressing proven
// out manually. Launches Illustrator itself if it isn't already open —
// the whole point of a person's own machine running this unattended is
// that they shouldn't have to remember to open Illustrator first.
// ponytail: fixed 8s grace period after a cold launch before sending `do
// javascript` — a real "wait until ready" would poll Illustrator's own
// state instead; bump the delay if a slower machine still races it.
function runOnMac(scriptFilePath) {
  const appleScript = [
    `set scriptPath to ${asQuote(scriptFilePath)}`,
    'set scriptCode to read (POSIX file scriptPath) as «class utf8»',
    'tell application id "com.adobe.illustrator"',
    '    if it is not running then',
    '        launch',
    '        delay 8',
    '    end if',
    '    activate',
    '    do javascript scriptCode',
    'end tell',
  ].join('\n');
  const appleScriptPath = scriptFilePath.replace(/\.jsx$/, '.applescript');
  writeFileSync(appleScriptPath, appleScript, 'utf8');
  execFileSync('osascript', [appleScriptPath], { stdio: 'pipe' });
}

// Windows: no AppleScript, so the equivalent bridge is Illustrator's own
// COM automation (New-Object -ComObject Illustrator.Application ->
// .DoJavaScript()) — instantiating that COM object launches Illustrator
// itself if it isn't already running, same as AppleScript's `launch`.
// ponytail: unverified against a real Windows Illustrator install — the
// exact ProgID/timing may need adjusting once tested for real.
function runOnWindows(scriptFilePath) {
  const psScript = [
    '$ErrorActionPreference = "Stop"',
    `$code = Get-Content -LiteralPath ${asQuote(scriptFilePath)} -Raw -Encoding UTF8`,
    '$illustrator = New-Object -ComObject Illustrator.Application',
    'Start-Sleep -Seconds 3',
    '$illustrator.DoJavaScript($code)',
  ].join('\r\n');
  const psScriptPath = scriptFilePath.replace(/\.jsx$/, '.ps1');
  writeFileSync(psScriptPath, psScript, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScriptPath], { stdio: 'pipe' });
}

function runIllustrator(scriptFilePath) {
  if (process.platform === 'win32') runOnWindows(scriptFilePath);
  else runOnMac(scriptFilePath);
}

function listAiFilesWithMtime(folder) {
  if (!existsSync(folder)) return new Map();
  const out = new Map();
  for (const name of readdirSync(folder)) {
    if (!/\.ai$/i.test(name)) continue;
    out.set(name, statSync(path.join(folder, name)).mtimeMs);
  }
  return out;
}

async function processJob(job) {
  console.log(`[${new Date().toISOString()}] Processing job ${job.id} (${job.filename})`);
  mkdirSync(TEMP_DIR, { recursive: true });
  const csvPath = path.join(TEMP_DIR, job.filename);
  writeFileSync(csvPath, job.csv_content, 'utf8');

  const outputFolder = outputFolderFor(job.filename);
  const before = listAiFilesWithMtime(outputFolder);
  const logFileName = logFileNameFor(job.id);
  const logPath = path.join(OUTPUT_ROOT, logFileName);
  rmSync(logPath, { force: true });

  let resultMessage;
  let status;
  try {
    const scriptFilePath = path.join(TEMP_DIR, `${job.id}.jsx`);
    writeFileSync(scriptFilePath, buildFullScript(csvPath, logFileName), 'utf8');
    // No timeout: this blocks until Illustrator finishes, which includes
    // waiting for a human to answer the name popup — that's expected.
    runIllustrator(scriptFilePath);
    resultMessage = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(Illustrator ran, but no log file was written.)';
    status = /Cancelled|失败: /.test(resultMessage) && !/存成:/.test(resultMessage) ? 'error' : 'done';
  } catch (err) {
    status = 'error';
    resultMessage = `Illustrator call failed: ${err.stderr?.toString() || err.message}`;
  } finally {
    rmSync(logPath, { force: true }); // don't leave a stray per-job log file behind on the (possibly shared) NAS
  }

  const outputPaths = [];
  if (status === 'done') {
    const after = listAiFilesWithMtime(outputFolder);
    for (const [name, mtime] of after) {
      if (before.get(name) === mtime) continue; // untouched leftover from an earlier job, skip
      const bucketPath = `${job.id}/${name}`;
      const { error } = await supabase.storage.from('ai-file-outputs')
        .upload(bucketPath, readFileSync(path.join(outputFolder, name)), { contentType: 'application/illustrator', upsert: true });
      if (error) { resultMessage += `\n\n[upload failed] ${name}: ${error.message}`; continue; }
      outputPaths.push(bucketPath);
    }
  }

  await supabase.from('ai_file_jobs').update({
    status, result_message: resultMessage, output_paths: outputPaths, updated_at: new Date().toISOString(),
  }).eq('id', job.id);
  console.log(`[${new Date().toISOString()}] Job ${job.id} -> ${status} (${outputPaths.length} file(s) uploaded)`);
}

async function tick() {
  let query = supabase
    .from('ai_file_jobs')
    .select('id, filename, csv_content')
    .eq('status', 'pending');
  if (watcherUserId) query = query.eq('requested_by', watcherUserId);
  const { data: jobs, error } = await query.order('created_at', { ascending: true }).limit(1);
  if (error) { console.error('Poll failed:', error.message); return; }
  if (!jobs || jobs.length === 0) return;
  const job = jobs[0];
  await supabase.from('ai_file_jobs').update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', job.id);
  try {
    await processJob(job);
  } catch (err) {
    console.error(`Job ${job.id} crashed:`, err);
    await supabase.from('ai_file_jobs').update({ status: 'error', result_message: String(err), updated_at: new Date().toISOString() }).eq('id', job.id);
  }
}

watcherUserId = await resolveWatcherUserId();
console.log(`Watching ai_file_jobs every ${POLL_INTERVAL_MS / 1000}s${watcherUserId ? ` for user ${watcherUserId}` : ' (any user)'}. Illustrator opens itself if needed. Ctrl+C to stop.`);
setInterval(tick, POLL_INTERVAL_MS);
tick();
