# Medar migration target: Mizbanfa shared hosting

Status: preparation plan, **not a claim that production has been migrated**.

## Target deployment shape

- Browser/mobile web assets: built static Vite assets served from the same origin as the API where possible.
- API: Node.js 22 process only if the purchased Mizbanfa plan explicitly supports a persistent Node.js application and the required process lifecycle.
- Database: PostgreSQL with a supported server-side driver. Do not assume the Neon serverless driver can connect to a provider's generic PostgreSQL service.
- Private evidence/files: private storage outside the public web root, with authenticated, tenant-scoped download routes. Do not store evidence under `public/` or expose direct public URLs.
- Scheduled work: hosting control-panel cron invoking a locked-down CLI task, or a provider-supported scheduler. Do not rely on an in-memory timer that may stop when the process sleeps.
- Secrets: server-side environment configuration only; never put database URLs, encryption keys, push keys, or passwords in `VITE_*` variables.
- Operations: HTTPS, health endpoint, structured logs without secrets/PII, database backups, private-file backups, and a tested restore/rollback procedure.

## Why the current Worker cannot simply be uploaded

The current API entrypoint is `worker/index.ts` and is exported as a Cloudflare Worker. It expects Worker bindings such as `DATABASE_URL`, `ASSETS`, and `FILE_STORE`; the private file adapter uses the R2-compatible `put/get/delete` interface. The scheduled handler runs notification jobs through the Worker scheduler. A shared-host deployment therefore needs explicit Node HTTP/runtime integration, a private filesystem/object-storage adapter, a PostgreSQL driver compatible with the selected database, and a cron entrypoint.

## Required gates before a safe cutover

1. Confirm the exact purchased plan supports Node.js 22, persistent app processes, environment variables, HTTPS/custom domain, outbound PostgreSQL access, cron, disk quotas and private writable storage.
2. Implement and test the Node runtime adapter and private-file adapter; make the database driver match the actual PostgreSQL endpoint.
3. Run all existing migrations on a clean disposable PostgreSQL instance and validate the upgrade path against a backup copy of the actual database. Do not run historical migrations blindly against production.
4. Test authentication, role/tenant isolation, supplier capacity evidence upload/review/download, orders, inventory, bank ledger, notifications, and scheduled jobs.
5. Import and reconcile the production database and private files; verify row counts and object checksums.
6. Deploy to a staging hostname, run smoke and adversarial access tests, then switch DNS only after sign-off.
7. Keep the previous deployment and a verified backup available until post-cutover checks pass.

## Cutover rules

- Never delete the existing database or private files as part of deployment.
- Never disable authorization or make private evidence publicly accessible to get a green build.
- A successful TypeScript build is not proof of production health.
- Mark the migration complete only after a real health check, login, core workflow, private-file access test, cron test, and backup restore test succeed.

## Known unresolved provider-specific facts

The exact Mizbanfa plan has not been supplied or independently verified for Node.js process hosting, PostgreSQL, cron, or private storage. Do not claim these features are available until Mizbanfa confirms them. If the shared plan is PHP-only or terminates long-running processes, select a Node-capable plan from Mizbanfa rather than trying to force the Worker into a static/PHP-only plan.
