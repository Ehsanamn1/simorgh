# Domestic Hosting Readiness — Madar

## Current purpose

This branch is a staged Node.js + MySQL migration effort. It does not replace the live Cloudflare Worker/Neon API and is not approved for production cutover. The existing operational Worker, PostgreSQL database, and live domain must remain unchanged until API parity, data migration, reconciliation, full integration tests and rollback all pass.

## Current architecture

- Frontend: React + TypeScript + Vite.
- Production API: Hono on Cloudflare Workers under `worker/index.ts`.
- Production database: Neon PostgreSQL through `@neondatabase/serverless`.
- Source migration history: 31 PostgreSQL migrations under `worker/migrations/`.
- The API uses PostgreSQL UUID/JSONB/enums/timestamptz, casts, partial indexes, `ON CONFLICT`, database functions/triggers, CTEs, row-locking and transaction semantics.

## Migration groundwork present on this branch

- Separate MySQL 8 migrations `worker/migrations/mysql/0001_foundation.sql` through `0005_notification_tenant_fk.sql`, including identity, sessions, company membership, core operations, extended operations, private-file metadata, event/exception tracking, messaging and notification/outbox structures.
- A guarded migration runner at `scripts/apply-medar-mysql-foundation.mjs`, with dry-run default, staging database-name checks, version/checksum tracking, required-table checks and idempotent constraint handling.
- A Node.js/Hono API adapter at `domestic-api/server.mjs` using `mysql2`.
- Implemented slice: health, authenticated sessions/login/logout/password change, membership provisioning and permissions, scoped data/RPC adapter, private storage handlers, notification read endpoints, device heartbeat, operational event creation/listing and exception lifecycle.
- Integration tests cover MySQL health/authentication, session rules, membership provisioning/role restrictions, notifications, client heartbeat, event idempotency, and acknowledge/start/resolve exception state transitions.

CI must pass for the latest commit before these changes are treated as validated. Even a green CI validates this slice and the converted schema chain—not all production workflows and not the actual MizbanFa environment.

## Important work still open

1. Port every remaining Worker route and middleware to Node.js/MySQL; produce route-to-test parity coverage. The current adapter is still missing several route groups, including bank reconciliation, AI providers/chat/action flows, contact operations, client administration/profile completion, invites/join parity, internal messaging, push subscription/delivery jobs and scheduled tasks.
2. Convert the remaining PostgreSQL functions, triggers, tenant policies and transaction/concurrency behavior. Preserve inventory and purchasing invariants using MySQL transactions and row locking; validate duplicate retries and competing requests.
3. Switch the frontend API base only after all required route semantics and browser tests are ready. The application currently remains wired to the live Worker API.
4. Build and validate a production data export/import and reconciliation tool. No production data migration from Neon is complete by virtue of a MySQL schema existing.
5. Verify the private file/storage strategy and replace Cloudflare R2 requirements where they are operationally essential; confirm maximum upload size and persistence on the shared host.
6. Replace Cloudflare scheduled jobs with a supported host scheduler, if available, and provide logs/alerts for failures.
7. Test the actual host's Node version, Passenger process lifecycle, environment variables, MySQL version/limits, filesystem persistence, HTTPS, outbound networking, backup/restore and resource limits.
8. Complete owner acceptance for authentication, permissions, two-company isolation, core farm/inventory/order/logistics/finance operations, files, notifications and backup recovery.
9. Provide an upload package only after route parity and staging acceptance; do not label a static frontend or partial API package production-ready.

## Confirmed HostMizbanFa limitations (per support reply)

- Shared hosting does not provide root access, remote database access or SSH-based deployment from GitHub Actions.
- Node.js is managed through cPanel's “Setup Node.js App”, with startup file/process settings chosen there.
- MySQL databases and users are created in cPanel; the database host is `localhost`.
- ZIP upload/extract through File Manager and manual updates are the supported route described by support.
- The current production DNS is still managed in Cloudflare. Do not change the apex A record until the new origin has passed staging tests and current mail-related DNS records are recorded.

Therefore, the existing SSH workflow must remain disabled for this account. Automatic GitHub-to-host deployment should not be promised unless the provider confirms an alternative supported mechanism (for example a supported secure file-transfer endpoint). GitHub CI can still build and test release artifacts, but manual File Manager upload remains the confirmed delivery path.

## Release gate

Keep the current Worker/Neon path live until:
- the Node/MySQL API covers all production-used Worker routes;
- the full MySQL migration/import and integrity reconciliation pass;
- authentication, role/tenant isolation, concurrency and file access tests pass;
- backup restore and rollback are rehearsed;
- the actual host passes HTTPS, health and workflow acceptance tests.

A green build, a MySQL schema or a ZIP file is not proof of a complete operational migration.
