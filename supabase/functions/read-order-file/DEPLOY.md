# read-order-file — deploy & switch on

AI sheet reader, phase 1 of the universal file-reader plan. It reads only the
Excel sheets the rule-based reader skipped. The model returns a mapping
(cell references) and the browser reads the values out of the file itself.

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
