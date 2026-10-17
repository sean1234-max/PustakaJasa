# read-order-file — deploy & switch on

AI sheet reader, phase 1 of the universal file-reader plan. It reads only the
Excel sheets the rule-based reader skipped. The model returns a mapping
(cell references) and the browser reads the values out of the file itself.

Phase 2 adds text PDFs (`kind: "pdf"`, pdfSchema.ts / pdfPrompt.ts). The
browser pulls the PDF's text with pdf.js (src/utils/pdfIr.js) and checks the
model's segment references against it (src/utils/pdfMapping.js). With the
flag on, the allowed roles can upload a .pdf on New Order. Scans and photos
have no text and are refused.

Nothing below has been run against production yet. Do the steps in order.

## 1. Database (migration 0085)

Apply `supabase/migrations/0085_ai_file_reader.sql`. It adds:

- `file_read_runs` (each AI reading, with cost; same input means the cached answer comes back),
- `ai_settings` (one row: `monthly_cap_myr` 150, `usd_to_myr` 4.30, `alert_pct` 80),
- `ai_budget_status()` (admin banner and Edge Functions),
- the daily `clear-old-ai-text` pg_cron job. It clears AI text older than 1 year. It never deletes rows or storage files.

To change the cap later:
`update ai_settings set monthly_cap_myr = 200;`

## 2. Secrets (Edge Functions → Secrets)

`ANTHROPIC_API_KEY` is already set (shared with the other AI functions). The
following are optional:

| Secret | Default | Meaning |
|---|---|---|
| `READER_MODEL` | `claude-sonnet-5-5` | main model |
| `READER_ESCALATE_MODEL` | `claude-opus-5-5` | second try when the first answer is unusable or unsure |
| `READER_ROLES` | `salesman,admin` | comma list of roles allowed to call it (admin can't reach New Order; it is allowed so the owner can test the reader) |
| `READER_RATE_LIMIT_PER_HOUR` | `30` | per user |
| `READER_ALLOWED_ORIGINS` | (any) | comma list, e.g. the production Vercel domain |

## 3. Deploy

```bash
supabase functions deploy read-order-file
supabase functions deploy check-engraving-text   # now also respects the site-wide cap
```

## 4. Switch on in the website (Vercel env)

- `VITE_AI_READER_ENABLED=1`
- `VITE_AI_READER_ROLES=salesman` (must be a role listed in `READER_ROLES`)

Redeploy the site. When an Excel import skips sheets, the salesman sees a
**Read N skipped sheet(s) with AI** button under the import message.

## Turning it off

Unset `VITE_AI_READER_ENABLED` and redeploy the site. The function can stay
deployed: nothing calls it while the flag is off.

## Custom Instructions for AI (kind "instructions", 2026-10-17)

New Order step 2 has a **Custom Instructions for AI** box for the roles that
can use the AI reader. After each upload the browser sends the instructions,
the file's name, the other uploaded files' names and the tabs the file
filled (`instructionsSchema.ts`). The model says which instructions are for
that file and what each asks; `src/utils/aiInstructions.js` re-checks the
answer and applies only:

- **TAJUK BESAR** set to text the user typed word for word;
- TAJUK BESAR at the **top or bottom** of the Reference Sample (`refOrder`,
  the `line_order` column SEAN.jsx stacks the plaque in).

Other formatting requests are copied into the order's Remark. Unclear,
conflicting or missing-file instructions are asked before Add to Cart. The
same instructions are also sent with a PDF / Word / skipped-sheet reading,
for the parts about how to read the file (they are part of the cache key).

No migration and no new secret: it uses the same `file_read_runs` cache,
rate limit and monthly cap. To switch on: deploy this function again
(`supabase functions deploy read-order-file`). The box shows only when
`VITE_AI_READER_ENABLED=1` and the role is in `VITE_AI_READER_ROLES`.

## Layout memory + shared cache (2026-10-17)

- **Same file, any user:** the same-file cache is now shared, so a file one
  user already had read is free for everyone after.
- **Layout memory** (`layoutMemory.ts`, table `ai_sheet_layouts`): when the
  AI maps an Excel sheet layout and is sure of it, the layout (headers and
  column roles only, no student data) is remembered for every user. A later
  sheet with the same headers in the same cells, from any school, is read
  from memory at no cost — straight after the import, without the "Read
  with AI" button. Not used when the user typed Custom Instructions.
- **Instructions:** when every instruction names another file, no AI call.

To switch on: run `supabase/migrations/0101_ai_sheet_layouts.sql`, then
`supabase functions deploy read-order-file --use-api`. Without the
migration the function still works; it just remembers nothing.

A layout that reads wrongly can be switched off:
`update ai_sheet_layouts set disabled = true where id = '…';`
