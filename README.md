# K1886 Transfer Portal

Next.js (App Router) + Tailwind + Supabase (custom `kstransfers` schema).

## Setup

1. **Supabase**: create a project, open *SQL Editor*, paste and run [schema.sql](schema.sql).
2. **Expose the schema**: *Project Settings → API → Exposed schemas* → add `kstransfers` → Save.
   (Without this, queries fail with "Invalid schema: kstransfers".)
3. Copy `.env.example` to `.env.local` and fill in the Project URL and anon key
   (*Project Settings → API*).
4. Run:
   ```bash
   npm install
   npm run dev
   ```
   Open http://localhost:3000.

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. On vercel.com: *Add New → Project*, import the repo (framework auto-detected as Next.js).
3. Add environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (Production, Preview, Development).
4. Deploy. Redeploy after changing env vars.

## Notes

- **Login and access**: users sign in with email and password. The first account to sign in
  becomes the admin; everyone else waits as "pending" until an admin approves them from the
  Members button. Database row-level security enforces this, so the public anon key alone
  exposes nothing. In Supabase check *Authentication → Providers → Email*: turn **Confirm email**
  off for instant sign-up, or keep it on (users must confirm before signing in).
- **Setup after pulling this version**: run `migration_login.sql` (or the whole `schema.sql`) once.
- **Coming from the login/workspaces version?** Run `migration_remove_workspaces.sql` once in
  Supabase. Your cycles and prospects are kept.
- **Player lookup**: `/api/lookup` proxies Century Games' `ks-cdk` endpoint exactly as specified.
  That is an unofficial endpoint and may require extra signing or change without notice; if it
  fails, the form falls back to manual entry.
- **Import format**: CSV with header `player_id,ign,kingdom,power,role,recruiter,status,notes`
  (the same format Export produces), or a JSON array of objects with those keys. Imports append
  to the selected cycle.

## Security

**What protects the data**
- Every table has row-level security. Only signed-in, admin-approved members can read or write; anonymous
  visitors get nothing, even with the public anon key (which is designed to be public).
- No SQL is ever built from user input: the app uses the Supabase client (parameterised requests) and
  database functions with fixed `search_path`, so SQL injection is not possible through the app.
- The database itself validates field lengths and formats, so direct API calls can't store junk.
- The audit log is written by database triggers and is read-only through the API.
- The lookup proxy needs a signed-in, approved account and is rate-limited per user.
- Security headers (CSP, frame blocking, no-sniff, HSTS) are set in `next.config.mjs`. If the CSP ever
  blocks something legitimate, set `DISABLE_CSP=1` while you investigate.
- CSV exports neutralise spreadsheet formulas; imports are size- and length-limited.

**Run once in Supabase**: `migration_login.sql` then `migration_security_hardening.sql`
(or just run the whole `schema.sql`).

**Checklist in the Supabase / Vercel dashboards (cannot be set from code)**
1. Never put the `service_role` / secret key in `NEXT_PUBLIC_*` variables or in Git. Only the anon key goes in the app.
2. *Authentication → Sign In / Providers → Email*: keep **Confirm email** on, set a minimum password length of 10+
   and require mixed characters; enable **Leaked password protection** if your plan has it.
3. *Authentication → Attack Protection*: enable **CAPTCHA** (Turnstile/hCaptcha) for sign-ups and sign-ins.
4. *Authentication → URL Configuration*: set Site URL to your real domain and keep the redirect allow-list to that domain only.
5. *Project Settings → API → Exposed schemas*: only `kstransfers` (remove `public` if you don't use it).
6. Turn on multi-factor authentication for your own Supabase and Vercel accounts, and for the GitHub repo.
7. Keep the GitHub repo **private**; in Vercel, keep env vars as "Sensitive" and protect Preview deployments.
8. Back up regularly (the CSV export works per cycle); consider a paid plan for point-in-time recovery.

## Testing

- `npm test` runs the automated tests (no Supabase needed): the helper logic in `lib/utils.js` (power parsing, CSV
  import/export safety, dates, cycle clock) and the `/api/lookup` route with every network call mocked
  (login required, approval required, input validation, rate limit, error handling).
- `tests/db_security_test.sql` checks the database rules for real (anonymous, stranger, pending, member and admin
  users, validation limits, audit-log protection). Run it in the Supabase SQL Editor after `schema.sql`: the
  report appears as the error message at the end, and nothing is kept.
