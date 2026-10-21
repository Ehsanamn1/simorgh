# Madar MySQL migration — engineering status

## Goal

Provide a domestic-hosting deployment for Madar that can continue serving authenticated operational workflows when access to international Cloudflare/Neon services is interrupted. The domestic API and database must be local to the Iranian host/network path; copying the frontend alone is not sufficient.

## Existing architecture

- Frontend: React + TypeScript + Vite, with PWA/mobile wrappers.
- API: Hono on Cloudflare Workers in worker/index.ts.
- Database: Neon PostgreSQL through @neondatabase/serverless.
- Schema: 31 ordered migrations in worker/migrations/.
- Existing operational deployment and CMS database are separate; keep that separation.

## Why a direct MySQL connection-string change is unsafe

The Worker and migration chain use PostgreSQL-only features, including:
- jsonb, PostgreSQL enum types, UUID defaults, and timestamptz;
- partial indexes and PostgreSQL-specific conflict handling;
- PL/pgSQL stored functions/RPCs, triggers, and schema guards;
- advisory locks / transactional concurrency protection for inventory and purchase-order flows;
- PostgreSQL operators and query syntax in the API.

MySQL does not implement these features identically. A mechanical SQL search-and-replace could silently weaken inventory integrity, tenant isolation, role checks, or financial settlement behavior.

## Required migration work

- [ ] Add a Node.js runtime compatible with the Iranian host's supported Node version.
- [ ] Replace the Neon connector with a MySQL driver behind a server-only repository/data-access layer.
- [ ] Convert all 31 migrations to a versioned MySQL 8 schema.
- [ ] Reimplement database functions/triggers as transaction-safe application services where MySQL behavior differs.
- [ ] Preserve tenant-scoped authorization and row-level checks in every API route.
- [ ] Preserve inventory concurrency guarantees with InnoDB transactions and explicit row locks (SELECT ... FOR UPDATE) where appropriate.
- [ ] Rework partial unique indexes and constraints with equivalent enforced behavior.
- [ ] Convert JSON fields and query semantics; add tests for JSON filtering and serialization.
- [ ] Replace Cloudflare-only R2/private file bindings with a domestic file-storage strategy or clearly mark those features unavailable until migrated.
- [ ] Replace Cloudflare Cron Triggers with a host scheduler/cron mechanism for notification and briefing jobs.
- [ ] Add MySQL integration tests for account provisioning, sessions, access requests, inventory movements, purchase orders, settlements, shipment evidence, audit trails, and cross-company access denial.
- [ ] Migrate production data with backup, staged import, row-count checks, key/relationship checks, and a rollback plan.

## Deployment rule

Do not change or remove the production Neon database, operational Worker, or existing migrations as part of the initial MySQL port. Build and test a separate MySQL staging environment first. The domestic API must not become the production path until all critical tests pass.

## Current status

This document records the migration scope; it is not evidence that the MySQL runtime or schema conversion is complete. The current operational Worker still requires Neon/PostgreSQL. The Raz Sahra CMS MySQL schema draft is maintained separately in the Ehsanamn1/razsahra repository.
