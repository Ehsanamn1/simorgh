# Medar database migrations

The canonical fresh-database chain is applied in filename order:

1. \`0001_foundation.sql\` — username/password identity, sessions, rate limits, audit and tenancy base.
2. \`0002_identity_foreign_keys.sql\` — identity foreign keys for profiles, memberships and access requests.
3. \`0003_operational_schema.sql\` — orders, inventory, shipping and farm operations.
4. \`0004_operational_integrity.sql\` — financial and operational integrity checks.
5. \`0005_partner_settlement_functions.sql\` — server-side partner statements and settlement workflow.
6. \`0006_core_data_api.sql\` — inventory view and protected operational RPCs.
7. \`0007_existing_medar_schema_compat.sql\` — private file metadata and workspace invite compatibility.
8. \`0008_operational_task_actions.sql\` — role-checked task start, submit and review functions.
9. \`0009_inventory_movement_concurrency_lock.sql\` — transaction-scoped company/product advisory locking for inventory movements, preventing concurrent deductions from overselling stock.
10. \`0010_purchase_order_lifecycle.sql\` — purchase orders, approval, partial/final receipt and atomically posted inventory movements with audit events.
11. \`0011_username_password_only.sql\` — make phone fields optional so sign-up needs only a username and password.

The \`Simorgh CI\` workflow runs this full sequence against a clean PostgreSQL 16 service and checks that the essential tables and RPCs exist.

## Existing production database

The production deployment workflow intentionally does **not** replay the fresh-database migrations against the existing Neon application database. It validates the established Medar tables, verifies the checksums of migrations 0007–0011, applies only missing compatible versions, verifies the stock-lock and purchase-order RPC implementations are present, and performs live Worker health and authorization smoke tests. Do not point that workflow at an empty database; use the canonical fresh-database sequence above on a dedicated new database first.

No test business records or owner accounts are inserted by these migrations.


- `0013_ai_assistant_and_contacts.sql`: adds company-scoped encrypted AI provider configuration, a minimal request-usage ledger for rate limits, and prerequisites for the secure assistant/contact import endpoints.
