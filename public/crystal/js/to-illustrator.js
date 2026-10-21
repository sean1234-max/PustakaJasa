// Crystals -> Illustrator through the AI File helper on this computer (scripts/ai-file-helper —
// the same program "Generate AI File" uses; Sean 2026-10-14, crystal Stage 4, in place of the
// colleague's own "Crystal Studio" program, pop-up window and crystalstudio:// link).
// The helper downloads each crystal's original .ai from our storage, runs the script in
// Illustrator and saves the .ai files under the AI FILE folder's OUTPUT/CRYSTAL. When Illustrator
// is done its report reaches the page as a "crystal-illustrator-report" message.
//
// The first time, Chrome asks to let this site reach "other apps on this device": Allow.

const HELPER = "http://127.0.0.1:47821";
const NEEDS_VERSION = 2; // the helper version that makes crystals
const POLL_MS = 3000, POLL_FOR_MS = 15 * 60 * 1000;

const report = (text) => window.postMessage({ type: "crystal-illustrator-report", text }, location.origin);

async function helperStatus() {
  try {
    const res = await fetch(HELPER + "/status");
    return res.ok ? await res.json() : null;
  } catch (e) {
    return null;
  }
}

// Illustrator's report once the helper's job ends (one Illustrator run at a time: it may queue)
async function follow(jobId) {
  const until = Date.now() + POLL_FOR_MS;
  while (Date.now() < until) {
    await new Promise((ok) => setTimeout(ok, POLL_MS));
    let job = null;
    try { job = await (await fetch(HELPER + "/jobs/" + encodeURIComponent(jobId))).json(); } catch (e) {}
    if (!job) return report("The AI File helper stopped answering — check Illustrator and the OUTPUT/CRYSTAL folder.");
    if (job.status === "done" || job.status === "error") {
      return report((job.status === "error" ? "Failed: " : "") + (job.message || job.status) + (job.files && job.files.length ? `\n${job.files.length} .ai file(s) in ${job.outputFolder}` : "") + (job.schoolCopy ? `\n${job.schoolCopy}` : ""));
    }
  }
}

// what: { job, files } — crystals made from their original .ai (vector-job.js) and/or .svg files
// ({ name, svg }); or just an array of .svg files.
// -> { ok, folder, error, old, missing, build } (never null: a missing helper is an answer too)
async function send(what) {
  const status = await helperStatus();
  if (!status) return { ok: false, missing: true, error: "The AI File helper isn't running on this computer. Install it once (scripts/ai-file-helper › install-windows.bat), or restart the computer." };
  if (!(status.version >= NEEDS_VERSION)) return { ok: false, old: true, error: "The AI File helper on this computer is an old version without crystals: run install-windows.bat from scripts/ai-file-helper again." };
  if (!status.nasOk) return { ok: false, error: `This computer can't reach the AI FILE folder (${status.aiFileDir}).` };
  const body = Array.isArray(what) ? { files: what } : { job: what.job || null, files: what.files || [] };
  let res, answer = {};
  try {
    res = await fetch(HELPER + "/crystal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    answer = await res.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, error: "Couldn't reach the AI File helper: " + e.message };
  }
  if (!res.ok) return { ok: false, error: answer.error || `AI File helper answered ${res.status}` };
  follow(answer.jobId);
  return { ok: true, folder: answer.folder, build: `AI File helper v${status.version}` };
}

// Kept the shape the studio and preview already use.
export function illustratorWindow() {
  return { send, sendWhenUp: send, cancel() {} };
}
