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


## Current deployment and next candidate

- **Latest live release:** [run 38982056018](https://github.com/Ehsanamn1/simorgh/actions/runs/38982056018) succeeded on commit `c186a8b7a0476261484d89ce91bf562b5d084219`.
- Pre-release typecheck, lint, unit tests, full browser acceptance suite, Worker build, Neon migrations, deploy, and health/database/auth guard smoke checks all passed.
- The live release includes the username-auth hardening, password-change API and signed-in self-service password-change dialog, Medar data adapter rename, and removal of unused Supabase/Neon Auth SDK dependencies.
- The current branch adds a company alert inbox API and RTL UI for overdue orders/tasks/invoices, submitted tasks, failed shipments and expiring farm licenses. Access-request alerts are returned only to owners/admins; the endpoint itself is restricted to owner/admin/staff. This alert-inbox addition is not live until the next tagged deployment completes.
- `docs/MEDAR_7_PRIORITY_ACCEPTANCE.md` tracks all seven priorities and distinguishes implemented source from production acceptance gates.

The password-change API requires the current password, limits attempts, hashes the replacement, revokes other sessions and records an audit event. The UI requires matching new-password entries and displays server errors.

## Remaining production-readiness gates

- Test a real temporary account through signup, login, session persistence, password change and logout, plus positive/negative role access cases.
- Verify data mapping and migration plan before moving existing Supabase operational data; existing operational data has not been migrated or deleted.
- R2-backed file/evidence paths remain unavailable until an alternative storage backend is selected and implemented.
- No SMS OTP, email recovery, bank transfer execution, or external integration is claimed as active.
- Keep PR #26 in Draft and GitHub Pages as fallback until the remaining acceptance/security/data migration gates pass.
