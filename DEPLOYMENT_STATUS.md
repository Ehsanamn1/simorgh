# Simorgh deployment status

Checked: 2026-10-15.

## Completed and verified

- Dedicated repository: https://github.com/Ehsanamn1/simorgh, branch `main`.
- Public site successfully deployed through GitHub Pages: https://ehsanamn1.github.io/simorgh/
- Successful deployment run: https://github.com/Ehsanamn1/simorgh/actions/runs/38744301095. The deploy action reported success and evaluated that site URL.
- Supabase project `aoxerjimfiwusidaparx` is `ACTIVE_HEALTHY`, region `eu-central-1` (Frankfurt), API URL `https://aoxerjimfiwusidaparx.supabase.co`.
- Cost confirmation for the Supabase project was $0/month at project creation. Actual usage/third-party services may be subject to their own limits or charges.
- Core migration `20261015000000_simorgh_core.sql` applied successfully. Supabase reports 18 application tables, all with RLS enabled, no demo rows, and migration `simorgh_core` recorded.
- Fixed missing composite unique key needed by the capacity allocation foreign key; correction committed in `6332bc22d3c406db2256b4a6d6b9b43a7253fb29`.
- GitHub Pages build checks passed: TypeScript, lint, 3 unit tests, production dependency audit (zero findings), and Vite build.
- GitHub Actions uses a `/simorgh/` base path; BrowserRouter and auth email redirects are base-path aware.
- The initial company `شبکه سیمرغ` exists in the database. No customer, supplier, order, or other operational sample data was inserted.

## Remaining before real operational use

- No users have signed up yet (`auth.users` count was 0 at the last check), so the initial owner membership has not yet been assigned.
- In Supabase Dashboard → Authentication → URL Configuration, set Site URL to `https://ehsanamn1.github.io/simorgh/` and add that exact URL to Redirect URLs. For local development, add `http://localhost:5173/**`.
- Register the trusted owner's account, confirm email if enabled, and grant that account the first `owner` membership through Supabase SQL Editor (instructions and an idempotent SQL example are in README.md).
- Test end-to-end login, signup, password reset, owner/staff/customer/supplier/driver role boundaries, RLS, private evidence storage, price agreements, capacity allocation, shipment stages, and finance workflows before entering live records.
- Supabase security/performance advisors return warnings for authenticated SECURITY DEFINER RPCs that are intentionally guarded in function bodies, plus index and RLS performance recommendations. Review the advisories and run role-specific security tests before scaling; this is not a substitute for an independent security audit.
- The financial screens record internal ledger status only; they do not initiate or verify bank transfers. Official tax invoices, bank integrations, SMS/transactional email and external ERP/Telegram integrations are not part of this version.

## Deployment and source

- Main static hosting workflow: `.github/workflows/pages.yml` (automatic on pushes to `main` and manual dispatch).
- Optional Cloudflare Pages workflow: `.github/workflows/deploy.yml`; requires Cloudflare API token/account ID and the two public Supabase frontend variables as GitHub repository secrets.
- Never put a Supabase secret/service-role key in a `VITE_` variable or commit private credentials to Git.
