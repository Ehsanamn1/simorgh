# Simorgh deployment status

Checked: 2026-10-15.

## Done and verified

- Source is published in the dedicated repository: https://github.com/Ehsanamn1/simorgh (branch `main`).
- The app is a React + TypeScript + Vite SPA, with Supabase client setup, a seed-free PostgreSQL migration, and Cloudflare Pages SPA fallback.
- Static syntax checks for TypeScript/TSX, CSS, HTML, and JSON passed in the authoring environment.
- GitHub Actions CI passed on application commit `0d9430a8cc2db87260576f73ff70d5a1c6e2ad78`: npm install, TypeScript typecheck, ESLint, Vitest, and Vite production build succeeded.
- CI now also audits production dependencies; the latest full run (including this production-only audit) passed on commit `bf6b91137e9b4d26008d9c6417ec192b2ba4b73a`.
- A manual Cloudflare Pages deployment workflow is present at `.github/workflows/deploy.yml`; it needs four repository secrets before it can deploy.
- The application migration defines 18 application tables and enables RLS on all 18.

## Not yet connected or verified

- There is currently no Supabase project in the connected Supabase account; the migration has not been applied to a live database.
- The application has not been deployed to Cloudflare Pages. No authenticated Cloudflare API integration or token is available in this environment, so the deployment workflow needs the user's Cloudflare token and account ID saved as GitHub repository secrets.
- Real account creation, memberships, role boundaries, RLS policies, private evidence storage, and the order-to-settlement flow have not been end-to-end tested against a live project.
- The initial `npm install` reported three dependency advisories overall (one moderate and two critical). The production-only audit passed; the remaining full-tree advisories still need review, since they can be development/transitive dependencies.

## Required next steps

1. Create/select a dedicated Supabase project. Confirm the organization and project cost before creation. Review and apply `supabase/migrations/20261015000000_simorgh_core.sql`, create the first owner membership, configure Auth URLs, and validate RLS using separate owner, staff, customer, supplier, and driver users.
2. Add these GitHub repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. Run **Actions → Deploy Simorgh to Cloudflare Pages → Run workflow**. It creates/uses the Pages project `simorgh-network` and publishes `dist/`.
4. Confirm a successful deployment URL; then test login, all role permissions, real price agreements, capacity allocation, shipments, storage evidence, and billing status flows before operational use.
5. Review any dependency security advisories and keep a reproducible lockfile in the repo.

Never put a Supabase service-role/secret key in a `VITE_` variable or commit credentials to Git.
