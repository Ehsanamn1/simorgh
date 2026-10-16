# Deployment status

## Current production status

GitHub Pages remains the existing public production surface until the guarded Cloudflare Worker release completes and live smoke tests pass. Do not treat the migration branch as production until the Worker deployment and authentication/authorization checks are verified.

## Cloudflare/Neon migration

The migration branch contains the Cloudflare Worker API foundation and Neon schema migrations. The release workflow only targets the isolated Neon migration endpoint with host prefix `ep-wild-mountain-baaweix2`; it refuses to run against a different endpoint. The workflow checks deployment credentials and runs typecheck, lint, unit tests, browser acceptance tests and production build before applying migrations.

## Storage decision

R2 provisioning and the R2 binding have been removed per product decision. The Worker can deploy without an R2 bucket. File/evidence upload and retrieval endpoints that depend on R2 will return a clear service-unavailable response until a different storage provider is implemented. No R2 bucket is created by the deployment workflow.

## Release checks

- Verify the workflow passes the credentials and isolated database endpoint guards.
- Require the full Playwright browser suite and production build to pass before Neon migrations.
- Verify the Worker health endpoint returns `ok: true` and `database: true`.
- GitHub Pages remains available as fallback until the deployed Worker URL passes live auth and authorization smoke tests.

## Latest deployment repair

The previous release successfully applied Neon migrations `0001` through `0006` and configured the Worker `DATABASE_URL` secret, but the Worker deployment was rejected because `public/_redirects` caused Cloudflare error 100324 (infinite redirect loop). That file has been removed; the Worker assets configuration already enables SPA fallback. Re-run the guarded release to deploy and smoke-test this corrected configuration. This status is not a claim that the Worker is live yet.
