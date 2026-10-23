# Domestic Medar API — migration slice

## Purpose and status

This directory contains a Node.js/Hono + MySQL implementation slice for the future domestic Madar runtime. It is being developed on the draft migration PR and is **not a production replacement for the live Cloudflare Worker/Neon API**. Keep the current operational Worker and PostgreSQL data unchanged until route parity, data import/reconciliation, integration tests, frontend cutover and rollback have all passed.

## Routes currently implemented in this slice

- Health: `GET /api/health` (confirms MySQL connectivity).
- Authentication: `GET /api/auth/me`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password/change`. Public signup and invite signup remain disabled.
- Memberships and access: list memberships, owner/admin member provisioning, deactivation/reset-password, and module permissions.
- Data-access adapter: `POST /api/data/:table`, `POST /api/rpc/:name`.
- Private files: scoped `GET/PUT /api/storage/:bucket` and `POST /api/storage/:bucket/remove`.
- Notifications: `GET /api/notifications`, `POST /api/notifications/read-all`, `POST /api/notifications/:id/read`.
- Client presence: `POST /api/client/heartbeat`.
- Operational monitoring: `GET/POST /api/operational/events`, `GET/POST /api/operational/exceptions`, and acknowledge/start/resolve exception transitions.

The new notification, heartbeat, event and exception handlers enforce a valid session, company membership and relevant module/role checks, use company-scoped database conditions, and have MySQL integration coverage in the migration CI workflow.

## Still not complete

This is **not a drop-in replacement yet**. The React application still uses the Worker API. Remaining API areas include bank reconciliation, AI provider configuration/chat/actions/realtime, contact classification/import, profile completion, client administration, invites/join and module permissions parity, internal messaging, push subscriptions/delivery jobs, and further end-to-end parity for all domain operations. Some operations in the current Worker rely on PostgreSQL-specific SQL, RPC functions, row locks, triggers, scheduled jobs or transactional guarantees that have not been fully recreated in this Node/MySQL runtime.

The MySQL schema migrations are a separate forward-only chain. They do not automatically migrate production data from Neon. A production data export/import utility, row/relationship/financial reconciliation, restore rehearsal and documented rollback remain required.

## Local/staging run

1. Use Node.js 20+ and a dedicated disposable MySQL 8 database. The migration test uses MySQL 8.4; confirm the host supports the schema's checks, generated columns and expression defaults.
2. Apply the versioned schema only to a disposable or explicitly provisioned staging database using the guarded migration scripts under `scripts/`. The default is a dry run, and the runner refuses non-staging names unless a separate explicit override is supplied.
3. Set `MYSQL_URL` to the staging connection and set `APP_ORIGIN` to the exact allowed origin when testing browser requests. Never use production credentials in CI.
4. From this directory run `npm install`, `npm run check`, `npm test` and, with a migrated test database, `npm run test:integration`.
5. Verify health, login/session behavior, module/tenant permissions, notifications, client heartbeat, event idempotency and the exception lifecycle. Test all unported routes before directing the frontend to this runtime.

## MizbanFa shared-hosting constraints

MizbanFa support has confirmed that the shared-host plan does not provide root access, remote database access or SSH-based GitHub Actions deployment. Therefore this repo must not promise automatic SSH deployment to that account. Build and test an upload package separately, then deploy through the host-supported cPanel/File Manager path. The domain and current Cloudflare production path must remain unchanged until a staged install is verified.

Never commit or paste database URLs, session secrets, worker tokens, or real administrator credentials.
