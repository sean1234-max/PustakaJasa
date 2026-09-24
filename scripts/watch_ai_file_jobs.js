// Local watcher for the "Generate AI File" button (Production order page,
// see src/lib/aiFileJobsApi.js + migration 0071). Polls ai_file_jobs for
// pending rows, runs SEAN.jsx against each job's CSV via the same
// AppleScript-do-javascript bridge already proven out manually (see
// "AI FILE/trigger_real_script_with_csv.applescript"), then uploads
// whatever .ai files that run produced to the ai-file-outputs bucket.
//
// Run on the Illustrator machine, with Illustrator already open:
//   node --env-file=.env scripts/watch_ai_file_jobs.js
// (needs SUPABASE_SERVICE_ROLE_KEY in .env — service role bypasses RLS,
// which is how this script is allowed to read every pending job and write
// status back; see migration 0071's policies. Get the key from the
// Supabase dashboard: Project Settings -> API -> service_role.)
//
// ponytail: single instance only, jobs processed one at a time, oldest
// first — no locking/leasing. Fine for one machine; add a claimed_by/
// leased_until column if this ever needs more than one watcher.
// ponytail: a job stuck in 'processing' (watcher crashed mid-run) needs a
// manual UPDATE back to 'pending' — no automatic recovery/retry.
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const AI_FILE_DIR = '/Users/seanng/Documents/Pustaka Jasa/AI FILE';
const SEAN_JSX_PATH = `${AI_FILE_DIR}/SEAN.jsx`;
const OUTPUT_ROOT = `${AI_FILE_DIR}/OUTPUT`;
const LOG_PATH = `${OUTPUT_ROOT}/last_run_log.txt`;
const POLL_INTERVAL_MS = 15000;
const TEMP_DIR = path.join(tmpdir(), 'ai-file-jobs');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env scripts/watch_ai_file_jobs.js');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

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

function asQuote(str) {
  return `"${String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Same recipe as trigger_real_script_with_csv.applescript (bundle id
// addressing + UTF-8 file read) — proven working manually, just with a
// dynamic csvPath instead of a hardcoded one. Deliberately does NOT set
// PRESET_OPERATOR_NAME: the Illustrator "enter your name" popup still
// shows, so whoever is at the machine has to type who actually ran it.
function buildAppleScript(csvPath) {
  return [
    `set csvPath to ${asQuote(csvPath)}`,
    `set scriptPath to ${asQuote(SEAN_JSX_PATH)}`,
    'set scriptCode to read (POSIX file scriptPath) as «class utf8»',
    'set presetLines to "var PRESET_CSV_PATH = " & quote & csvPath & quote & ";" & return',
    'set fullCode to presetLines & scriptCode',
    'tell application id "com.adobe.illustrator"',
    '    activate',
    '    do javascript fullCode',
    'end tell',
  ].join('\n');
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
  rmSync(LOG_PATH, { force: true });

  let resultMessage;
  let status;
  try {
    const appleScriptPath = path.join(TEMP_DIR, `${job.id}.applescript`);
    writeFileSync(appleScriptPath, buildAppleScript(csvPath), 'utf8');
    // No timeout: this blocks until Illustrator finishes, which includes
    // waiting for a human to answer the name popup — that's expected.
    execFileSync('osascript', [appleScriptPath], { stdio: 'pipe' });
    resultMessage = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8') : '(Illustrator ran, but no log file was written.)';
    status = /Cancelled|失败: /.test(resultMessage) && !/存成:/.test(resultMessage) ? 'error' : 'done';
  } catch (err) {
    status = 'error';
    resultMessage = `AppleScript/Illustrator call failed: ${err.stderr?.toString() || err.message}`;
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
  const { data: jobs, error } = await supabase
    .from('ai_file_jobs')
    .select('id, filename, csv_content')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);
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

console.log(`Watching ai_file_jobs every ${POLL_INTERVAL_MS / 1000}s. Illustrator must already be open. Ctrl+C to stop.`);
setInterval(tick, POLL_INTERVAL_MS);
tick();
