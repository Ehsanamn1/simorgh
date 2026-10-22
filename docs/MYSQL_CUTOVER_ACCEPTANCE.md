# Medar — domestic MySQL migration acceptance gate

Status: **NO-GO for runtime/database cutover**. Medar currently depends on a Cloudflare Worker and Neon/PostgreSQL. This file tracks work required to port it; it does not claim the port or data migration is complete.

## Scope and separation
- Preserve the currently working `medar-ops` Worker and its Neon database until the replacement has passed all gates.
- Keep Raz Sahra CMS data/auth isolated from Medar operational data/auth.
- Do not reuse CMS users, session cookies, secrets, or database credentials as Medar operational credentials.
- Do not change the integrated Raz Sahra source pin to an unverified Medar build.

## Required work
1. Inventory every Worker route, SQL statement, migration, PostgreSQL function/RPC, transaction boundary, and database-specific behavior.
2. Implement a Node.js runtime adapter and MySQL repository layer with the same authorization and response contract. Preserve server-derived tenant/role scope, HttpOnly sessions, rate limits, idempotency, audit logs, and origin checks.
3. Convert schema/migrations with explicit equivalents for JSON, timestamps, uniqueness, locking, transaction isolation, conflict handling, generated IDs, and ledger/accounting invariants.
4. Run unit, API contract, integration, concurrency, and desktop/mobile E2E tests against a disposable MySQL instance. Include inventory contention, order lifecycle, partner settlement, role isolation, file authorization, and rollback behavior.
5. Create a restorable encrypted backup and a repeatable dry-run importer. Compare per-table counts, keys, relations, null counts, and canonicalized hashes. Do not run destructive SQL or overwrite the source database.
6. Verify the actual host supports the required Node runtime, process supervision, TLS, environment secrets, outbound/inbound database connectivity, scheduled backups, logs, and health probes.
7. Deploy a staging instance with synthetic data, rehearse rollback, and run authenticated acceptance with authorized real roles before any production cutover.
8. After the new runtime is independently verified, update Raz Sahra's immutable Medar source pin only through the normal parent build/deploy/smoke sequence.

## Hard stop conditions
Any schema mismatch, missing row, permission regression, failed restore, unverified host setting, or missing rollback is a hard stop. No cutover based solely on a successful build.

## Evidence checklist
| Gate | Required evidence | Status |
|---|---|---|
| Full route/SQL inventory | Machine-readable inventory reviewed | BLOCKED |
| MySQL schema parity | Constraints/indexes/transaction semantics tested | BLOCKED |
| Runtime/API parity | Contract suite against old and new adapters | BLOCKED |
| Data migration | Backup, dry-run, row/hash reconciliation | BLOCKED |
| Operational acceptance | Authenticated role and accounting E2E | BLOCKED |
| Host deployment | Staging URL, logs, health checks | BLOCKED |
| Rollback/restore | Rehearsal result and recovery time | BLOCKED |
| Parent-site integration | Verified source pin and production smoke | BLOCKED |

## Current safe state
Keep the existing Neon/PostgreSQL runtime and deployment active. Do not remove secrets or change production database bindings while these gates remain open.
