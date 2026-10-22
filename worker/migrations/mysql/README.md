# Medar MySQL migration status

This is a separate, forward-only MySQL schema chain for the planned domestic Node.js runtime. It does not replace or rewrite the existing PostgreSQL migrations in `worker/migrations/`.

## MySQL schema migrations converted and covered by disposable-MySQL CI

- `0001_foundation.sql`: users, sessions, login attempts, rate limits, audit log, companies, profiles, memberships, owner registry and access requests.
- `0002_operational_schema.sql`: core business operations including customers, suppliers, products, orders, capacity, lots, quality, shipments, invoices, settlements, farm sites, production, tasks, partner finance, inventory and goals.
- `0003_extended_schema.sql`: invites, private files, purchase orders, client presence, AI provider/usage/action records, module permissions, bank reconciliation, operational events/exceptions, messaging and push notifications.
- `0004_delivery_video_evidence.sql`: restart-safe forward migration allowing private video delivery evidence without rewriting the earlier operational migration.
- `0005_notification_tenant_fk.sql`: replaces the notification-outbox single-column reference with a composite `(company_id, notification_id)` foreign key, preventing cross-company notification references.

The CI test applies the chain to a disposable MySQL 8.4 service, checks tenant-scoped foreign keys and accounting/quantity constraints, reruns migrations to check idempotency, and exercises the first Node/MySQL authentication slice.

## Still not production-ready

The full port is **not complete**. The live Worker API in `worker/index.ts` still uses Neon/PostgreSQL. PostgreSQL functions, triggers, RLS assumptions, concurrency locks and all operational API routes have not been fully ported to the Node/MySQL runtime. The MySQL data importer, production data reconciliation, domestic-hosting deployment and rollback rehearsal also remain outstanding.

Do not point the live application at MySQL or run this migration chain on a production database until the API port, data migration, access-control review, financial reconciliation and rollback tests have passed.

## Required runtime

MySQL 8.0.16+ is the minimum assumed by the current schema because it relies on enforced CHECK constraints; expression defaults require MySQL 8.0.13+. Use InnoDB, utf8mb4, foreign keys, generated columns and transaction support. The CI currently tests MySQL 8.4; verify the hosting provider's actual server version and capabilities before applying.
