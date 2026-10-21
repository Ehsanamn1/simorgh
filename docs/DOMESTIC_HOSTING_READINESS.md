# Domestic Hosting Readiness — Madar

## Current purpose
This branch documents and checks the existing web application while preparing a future Node.js + MySQL deployment. The workflow is CI-only: it does not deploy or claim that the operational backend has been migrated.

## CI
`.github/workflows/domestic-ci.yml` runs typecheck, lint, unit/component tests and a frontend build, then uploads a review artifact. Passing this workflow only validates the current frontend source; it does not validate a MySQL backend or prove the application can operate on HostMizbanFa.

## Current architecture constraints
- Frontend: React + TypeScript + Vite.
- API: Hono worker under `worker/index.ts`.
- Data access: `@neondatabase/serverless` and PostgreSQL SQL.
- Existing schema history: 31 numbered migrations under `worker/migrations/`.
- Existing API depends on PostgreSQL UUID/JSONB/enums/timestamptz, casts, partial indexes, conflict clauses, CTEs, functions/triggers and row-locking patterns. Some paths depend on transactional/concurrency behavior.

## Required migration work
1. Build a Node.js Hono server adapter compatible with the hosting process model, with graceful shutdown and request limits.
2. Inventory every API route, SQL query, migration, trigger/function and scheduled task. Produce a traceable route-to-test matrix.
3. Convert the schema and all 31 migrations to MySQL 8-compatible migrations; do not just translate the initial tables.
4. Replace Neon query calls with a supported MySQL driver and explicit transaction boundaries. Preserve company/tenant scoping, membership and module permissions, audit logs, encrypted secrets, session handling and idempotency.
5. Re-design critical concurrency paths (stock/inventory, purchase orders, capacity commitments, notification outbox) using transactions, unique constraints and appropriate row locks. Test concurrent requests, retries and duplicate delivery.
6. Replace Cloudflare assets/R2 bindings with a verified domestic file-storage approach. Replace scheduled triggers with a verified host cron or scheduler, with idempotent jobs and observable failures.
7. Add integration tests against the actual MySQL major version and test login, permissions, CRUD, accounting, inventory, orders, shipment workflows, file access, notification jobs, tenant isolation and database outages.
8. Provide a dry-run data export/import tool, backups and a verified restore drill; compare table row counts, foreign-key relationships, key aggregates and checksums where practical.
9. Verify host Node version, persistent process support, environment variables, database limits, HTTPS, custom subdomain, cron, outbound network policy and deployment access.
10. Add a deployment workflow only after the host protocol is known. Use staged releases, health checks and rollback; never auto-run destructive migrations against production.

## Reserved GitHub Actions secrets for later
- `HOST_SSH_HOST`
- `HOST_SSH_USER`
- `HOST_SSH_KEY`
- `HOST_DEPLOY_PATH`
- `HOST_HEALTHCHECK_URL`

Keep runtime database credentials in the host's protected environment settings where possible. Never commit or paste credentials into chat.

## Release gate
Keep the existing Worker/Neon deployment and production database untouched until the MySQL implementation, migration rehearsal, backup restore, concurrency tests and cutover/rollback plan pass. A frontend artifact is not an operational Madar release.
