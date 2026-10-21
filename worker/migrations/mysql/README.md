# Medar MySQL migration status

This directory is the separate MySQL migration chain for domestic-hosting work. It does not replace or modify the current PostgreSQL migrations in `worker/migrations/`.

## Ported so far

- `0001_foundation.sql`: identity, sessions, login attempts, rate limits, audit log, companies, profiles, memberships and access requests. PostgreSQL partial uniqueness is represented with generated columns and unique indexes.

## Not ready for production

The MySQL chain is incomplete. Migrations 0002–0031 have not been converted and tested, including operational tables, partner settlement functions, inventory concurrency controls, purchase-order lifecycle, AI approvals, notifications, private evidence storage, and event hooks. The Worker API still uses Neon/PostgreSQL SQL. Do not point the live app to MySQL or use this directory for production until the remaining migrations, API query port, data validation, and integration tests are complete.

## Required runtime

MySQL 8.0.13+ (for expression defaults), InnoDB, utf8mb4, enforced CHECK constraints, generated columns, foreign keys, and transaction support. Verify the actual hosting provider's server version before applying this chain.
