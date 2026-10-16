# Deployment status

## Live deployment

- **Medar Worker:** https://medar-api.dengxiao445.workers.dev
- **Health endpoint:** https://medar-api.dengxiao445.workers.dev/api/health
- **Latest successful release:** [GitHub Actions run 38979401130](https://github.com/Ehsanamn1/simorgh/actions/runs/38979401130)
- **Verified health response:** `{"ok":true,"service":"medar-api","database":true,"auth":"username-password"}`
- **Neon migrations:** `worker/migrations/0001` through `0006` completed successfully against the isolated migration branch.
- **Authentication guard smoke checks:** passed for unauthenticated `/api/auth/me` (401), protected `/api/workspace/memberships` (401), and invalid signup payload validation (400).
- **CI:** Worker CI, Simorgh CI, Android, and iOS checks on the deployment repair commit passed.

The Worker and API are online. GitHub Pages remains available as a fallback while the migration branch is reviewed. This successful health/auth-guard smoke test is not a substitute for a real account signup/login/logout and role-by-role authorization acceptance test.

## Cloudflare/Neon migration

The release workflow targets only the isolated Neon migration endpoint with host prefix `ep-wild-mountain-baaweix2`; it refuses to migrate a different endpoint. Credentials, typecheck, lint, unit tests, browser acceptance tests, and production build run before migrations.

## Storage decision

R2 provisioning and the R2 binding have been removed per product decision. File/evidence upload and retrieval paths that depend on R2 remain unavailable until an alternative storage provider is implemented. No R2 bucket is created by the deployment workflow.

## Remaining production-readiness gates

- Test a real temporary account through signup, login, session persistence, logout, and negative role/access cases.
- Verify data mapping and migration plan before moving existing Supabase operational data; existing Supabase data has not been migrated or deleted.
- Keep file/evidence upload and retrieval disabled until an alternative storage backend is implemented.
- No SMS OTP, email recovery, bank transfer execution, or external integration is claimed as active.
- Keep PR #26 in Draft until these remaining acceptance/security gates are reviewed. Do not remove the GitHub Pages fallback until the broader cutover is approved.
