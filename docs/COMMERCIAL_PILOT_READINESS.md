# Medar Commercial Pilot Readiness

This is an evidence gate, not a claim that the product is commercially ready. Mark items complete only with a linked test run, deployment result, or reproducible evidence.

## Current decision

**NOT YET APPROVED for broad commercial use.** A supervised pilot may begin only after release, authentication/tenant isolation, and critical workflow gates pass.

The repository README documents unfinished private file storage (file endpoints previously return HTTP 503 without R2), incomplete offline write synchronization/conflict handling, and unverified end-to-end commercial workflows. Legacy operational data migration is not assumed complete.

## Stage 1 — Release integrity

- [ ] Identify the intended production commit on `main`.
- [ ] Confirm CI for typecheck, lint, unit tests, browser acceptance, Worker build, migrations, deployment, and live smoke checks.
- [ ] Verify live `/api/health` and database connectivity on the intended operational Worker.
- [ ] Verify `MEDAR_MODE=operational` only on the intended operational Worker; public demo remains fail-closed/read-only.
- [ ] Record commit SHA, workflow run IDs, deployment URL, and verification date.

## Stage 2 — Simplify the interface safely

- [ ] Review PR #103 and its latest CI status before merge/deploy.
- [ ] Keep three primary navigation groups: Home & Follow-up, Daily Operations, Workspace Management.
- [ ] Limit dashboard shortcuts to four role-relevant actions; retain other implemented capabilities through the module menu.
- [ ] Verify role-aware mobile navigation and safe-area layout for owner/admin/staff, supplier, and driver.
- [ ] Verify the help panel stays dismissed after being closed and across route changes.
- [ ] Ensure every visible action works; clearly label or hide incomplete capabilities rather than faking success.
- [ ] Run desktop/mobile browser checks, including RTL, keyboard focus, and horizontal overflow.

## Stage 3 — Authentication and tenant isolation

- [ ] Verify signup creates exactly one workspace and owner account.
- [ ] Verify login, session persistence, password change, logout, and session revocation.
- [ ] Complete a real temporary-account lifecycle smoke test on the intended deployment.
- [ ] Verify two workspaces cannot read or mutate each other's records.
- [ ] Test allowed and denied actions for roles actually supported by source.
- [ ] Verify normalized username and role-linked records persist correctly.
- [ ] Review audit events, rate limits, and unauthorized API responses.

## Stage 4 — Critical operational workflows

For every workflow, capture persisted database evidence and a repeatable test, not only a UI toast.

- [ ] Farm/site and production cycle: lifecycle, permissions, validation, reporting.
- [ ] Supplier/partner and contract lifecycle: tenant scoping and status transitions.
- [ ] Inventory ledger and stock changes: source of truth, duplicate prevention, corrections/rollback.
- [ ] Quality inspection and incidents: status transitions and related records.
- [ ] Partner finance and settlements: calculation source, approval rules, reconciliation, audit trail.
- [ ] Tasks, evidence metadata, and alerts: recipient and role scoping.
- [ ] Validate only workflows that exist in source; mark missing modules as not implemented.

## Stage 5 — Limitations and data migration

- [ ] Decide whether private file/evidence storage is required for the pilot. If required, configure a supported backend and prove upload, private retrieval, access control, and deletion.
- [ ] Do not promise offline writes until queueing, retries, idempotency, conflict handling, and recovery are implemented and tested.
- [ ] Before migrating legacy operational data, create and restore-test a backup, map schemas, compare counts/relationships, run a controlled dry run, document rollback, and obtain explicit approval.
- [ ] Verify AI only when a provider is configured; keep keys server-side and prevent unapproved financial/irreversible actions.

## Stage 6 — Supervised pilot

- [ ] Select one real workspace and a small set of authorized users.
- [ ] Define real daily tasks and expected results before onboarding.
- [ ] Confirm tenant isolation, backup/recovery expectations, and required file handling before using real records.
- [ ] Record confusion, failed operations, support needs, and defects during the pilot.
- [ ] Approve wider rollout only after critical issues are fixed and acceptance tests pass.

## Release decision

- **NO-GO:** tenant isolation, authentication lifecycle, production health, or a critical workflow fails.
- **CONDITIONAL PILOT:** critical gates pass and accepted limitations are documented for pilot users.
- **GO for wider use:** pilot succeeds, recovery is understood, and required workflows pass.

A code change alone is not evidence of completion. Attach the exact test run, commit, endpoint result, or reproducible evidence.