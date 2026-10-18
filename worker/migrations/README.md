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

12. `0012_client_presence.sql` — track authenticated web/mobile clients in the central manager panel.
13. `0013_ai_assistant_and_contacts.sql` — company-scoped AI provider keys and usage accounting.
14. `0014_contact_intelligence.sql` — keep organization, email, notes, tags, address and source metadata on imported customer/supplier records, with company-scoped phone lookup indexes.


15. `0015_ai_action_approval_ledger.sql` — stores inert company-scoped agent action proposals and adds an idempotent, audited task-creation function. Proposal creation never writes an operational task; executing the tool requires an authenticated active membership and a separate explicit confirmation.

The Cloudflare operational deployment workflow applies this migration after validating the established Medar database. CI verifies the table and function against a fresh PostgreSQL database. This migration does not configure third-party providers and does not initiate financial actions.


16. `0016_membership_module_permissions.sql` — creates optional company-scoped module/action overrides for individual memberships and a trigger that rejects cross-company membership IDs. The Worker still applies role and entity-level scopes; per-module overrides only narrow those permissions.


17. `0017_delivery_video_evidence.sql` — adds the `video` delivery-evidence kind so private shipment evidence can describe video files. The Worker accepts MP4, WebM and QuickTime/MOV in the private evidence buckets up to 50 MiB; access still requires a valid company/mission relationship and the private R2 binding.


18. `0018_bank_reconciliation_ledger.sql` — creates company-scoped bank account metadata and an idempotent imported-transaction ledger with an auditable manual reconciliation link. It stores no online banking credentials and never initiates transfers.
