# extract-order-file — deploy & test

AI order-file extraction Edge Function (Phase 4, Batch D). Not wired into the
app yet — Batch E does that behind the `VITE_AI_IMPORT_ENABLED` flag.

## Prerequisites (one-time)

1. **Migrations 0045 + 0046 applied** (the `ai_extraction_runs` table and the
   `order-imports` bucket). Already done.
2. **Secret set** in Supabase → Edge Functions → Secrets:
   - `ANTHROPIC_API_KEY` = your Anthropic API key. Already done.
   - The rest are optional overrides (sane defaults in `index.ts`):
     `EXTRACT_MODEL` (default `claude-sonnet-5`), `EXTRACT_MONTHLY_CAP_USD`
     (default `6` ≈ RM30 per user per calendar month), `EXTRACT_RATE_LIMIT_PER_HOUR`
     (default `20`), `EXTRACT_PRICE_IN_USD` / `EXTRACT_PRICE_OUT_USD` (per
     million tokens, defaults `3` / `15`).
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are
   provided automatically.

## Deploy

From the project root, with the Supabase CLI logged in and linked:

```bash
supabase functions deploy extract-order-file
```

Or paste the three files into the dashboard's function editor
(Edge Functions → Create a new function → `extract-order-file`), keeping
`schema.ts` and `prompt.ts` as separate files next to `index.ts`.

JWT verification is on by default — the function additionally re-checks the
caller's role server-side (`teacher` / `salesman` / `admin`).

## Smoke test (curl)

Get a logged-in user's access token (from the browser devtools → Application
→ Local Storage → the `sb-...-auth-token` entry → `access_token`), then:

```bash
curl -i -X POST \
  "https://<project-ref>.functions.supabase.co/extract-order-file" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileName": "test.xlsx",
    "sheetsText": "SHEET: TOKOH\nMAJLIS APRESIASI KECEMERLANGAN 2025\nANUGERAH IKON MURID\nTOKOH | KUANTITI | JENIS PLAK\nANUGERAH IKON MURID | 30 | PK 020 A\nJENIS PLAK | QTY\nPK 020 A | 30"
  }'
```

Expected: `{ "runId": "...", "status": "succeeded", "result": { "isOrderFile": true, "awards": [ { "awardName": "ANUGERAH IKON MURID", "jenisPlak": "PK 020 A", "plaques": [ { "line1": "", "line2": "", "count": 30 } ], ... } ], ... } }`

Then check the row it wrote:

```sql
select id, status, attempt, model, prompt_tokens, completion_tokens,
       cost_usd_cents, error, created_at, completed_at
from ai_extraction_runs
order by created_at desc
limit 5;
```

## What to watch

- `status = 'succeeded'` with a small `cost_usd_cents` (a few cents) → good.
- `status = 'needs_human'` → the model's output failed schema validation
  twice; `error` says why. The real fix is usually a prompt tweak.
- `status = 'failed'` → an API/network error; `error` has the detail.
- 402 response → the caller hit their monthly cap. 429 → hourly rate limit.

## Rollback

`supabase functions delete extract-order-file` (or delete it in the
dashboard). Nothing else references it; the table and bucket are harmless
when idle.
