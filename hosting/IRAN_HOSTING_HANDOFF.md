# Madar — Iranian Shared Hosting Handoff

## Target outcome
A tested, upload-ready Madar release for HostMizbanFa. Core farm/network operations must run on domestic Node.js + MySQL rather than Cloudflare Workers + Neon, and must not rely on foreign APIs for essential reads/writes during an international outage.

## Migration requirements
- Inventory every Worker route, middleware, scheduled task, binding, storage object, and database call before porting.
- Replace Hono/Cloudflare Worker entry points with a Node.js HTTP server compatible with the host's supported Node runtime.
- Replace `@neondatabase/serverless` and PostgreSQL SQL with MySQL-compatible data access and explicit transaction boundaries.
- Port all 31 existing migrations and document any PostgreSQL-specific enum, JSONB, UUID, timestamp, partial-index, trigger, function/RPC, and concurrency semantics.
- Preserve authorization, tenant/role scoping, audit events, idempotency and race-condition protection. Do not perform a mechanical placeholder rewrite.
- Keep Madar operational data separate from Raz Sahra CMS data.
- Inventory R2/file storage, cron/scheduled work, notifications, maps/geocoding, AI providers and any other foreign dependencies. Replace essential dependencies with local-compatible options or explicitly mark them optional/degraded.
- Build frontend assets before packaging; do not require a build toolchain on the shared host unless the host confirms it.
- Include migrations, environment-variable template, health endpoint, backup/export/restore procedure, rollback plan, and Persian non-technical setup guide.
- Never include real credentials or default production admin passwords in the repository or ZIP.

## Host assumptions to verify
HostMizbanFa support reportedly says Node.js, terminal access, MySQL, and process persistence are available. Verify Node version, startup/process manager, port/proxy routing, environment variables, MySQL version/limits, filesystem permissions, HTTPS, backup restoration and resource limits before release.

## Release acceptance tests
1. Empty-database installation and repeat-safe migrations.
2. Database integrity and row-count reconciliation for any migrated data.
3. Authentication, session expiry, authorization and role separation.
4. Core farm, partner, capacity, order, inventory, logistics, finance and audit workflows.
5. Transaction rollback and concurrent-update tests for workflows that previously depended on PostgreSQL guarantees.
6. Local asset/file availability and documented behavior if optional external APIs fail.
7. Health checks disclose no secrets.
8. Tested database backup and restore.
9. Core workflow test with foreign services blocked.
10. Persian upload/setup guide tested by a non-developer.

## Release gate
The current PostgreSQL/Cloudflare application is not considered migrated merely because a MySQL schema or guide exists. Do not label a package production-ready until actual application code, all 31 migration semantics, and deployment have passed the tests above.
