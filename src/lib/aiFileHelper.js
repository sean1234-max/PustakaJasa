// Talks to the "AI File helper" running on THIS computer
// (scripts/ai-file-helper/). A web page can't check local folders or start
// Illustrator, so "Generate AI File" asks the helper on the clicking
// computer instead — and only that computer runs the job.
const HELPER_URL = 'http://127.0.0.1:47821';

// null = no helper answering on this computer (not installed / not running).
// No timeout on purpose: the first call may sit behind Chrome's "allow this
// site to access other apps on this device" prompt until the user answers.
export async function getAiFileHelperStatus() {
  try {
    const res = await fetch(`${HELPER_URL}/status`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function startAiFileHelperJob(filename, csv) {
  const res = await fetch(`${HELPER_URL}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, csv }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `AI File helper returned ${res.status}`);
  return body.jobId;
}

// null = the helper stopped answering (quit/restarted mid-job).
export async function getAiFileHelperJob(jobId) {
  try {
    const res = await fetch(`${HELPER_URL}/jobs/${encodeURIComponent(jobId)}`);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
