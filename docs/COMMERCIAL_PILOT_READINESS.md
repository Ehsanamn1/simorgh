# Medar Commercial Pilot Readiness

**Last reconciled:** 2026-10-21  
**Decision:** **NO-GO for broad commercial use; do not describe the product as commercially accepted yet.** The current operational release, Worker mode, database health, route protection, core CI, and Android/iOS builds are verified. A supervised pilot should be considered only after the owner-session and required data/storage gates below are completed.

This is a go/no-go evidence tracker, not a feature list. A checkbox becomes complete only after linked test output or an authorized reproducible acceptance result supports it.

## Current verified release

- Medar main commit: `70329106d6cd921e1c036714157986b72e0ea201`
- Main CI (typecheck, lint, unit, clean PostgreSQL migration/account SQL, browser suites, web/PWA builds): [run 39653283320](https://github.com/Ehsanamn1/simorgh/actions/runs/39653283320) — **passed**.
- Cloudflare Worker publish and live smoke (operational-mode identity, Neon health, public signup/invite denial, unauthenticated access, CORS/origin protection, desktop/mobile sign-in, public-demo redirect): [run 39653283449](https://github.com/Ehsanamn1/simorgh/actions/runs/39653283449) — **passed**.
- Android build: [run 39653283373](https://github.com/Ehsanamn1/simorgh/actions/runs/39653283373) — **passed**.
- iOS Simulator build: [run 39653283318](https://github.com/Ehsanamn1/simorgh/actions/runs/39653283318) — **passed**.
- Raz Sahra embeds this runtime pin at `/madar/`; the latest verified parent Pages run is [39668463557](https://github.com/Ehsanamn1/razsahra/actions/runs/39668463557) — **passed**. Build marker: `PARENT_SOURCE_SHA=6f8e3a9b49148741b2e6758b21bbebeb5cb00213`, `MEDAR_SOURCE_SHA=70329106d6cd921e1c036714157986b72e0ea201`; generated JS contains the exact combined marker. Unique deployment: `https://0a99d6c7.razsahra.pages.dev`. The smoke test verified HTTP 200 for `/`, `/madar/`, and `/madar/app/home` at canonical and unique origins, both DB health checks, and HTTP 401 for unauthenticated CMS-admin access. This was a documentation-evidence replay; the runtime Medar pin remained unchanged.

## Stage 1 — Release integrity

- [x] Pin the embedded source to the exact verified Medar main commit and assert the combined source marker in the generated parent bundle.
- [x] Verify the production Worker reports `service: "medar-ops"`, connected database, and username/password authentication.
- [x] Verify public account signup and invitation-code signup are disabled; unauthorized workspace access and untrusted-origin mutations are denied.
- [x] Verify `/madar/` and deep-link refresh from the parent origin, CMS health, upstream Medar health, and unauthenticated CMS-admin denial.
- [x] Record exact source SHAs, workflow runs, and deployment URLs in the canonical contract and cross-project status register.

## Stage 2 — Interface and operational boundary

- [x] Make implemented quality, partner-finance, partner-settlement, and supplier-settlement routes reachable for the permitted roles.
- [x] Restrict creation of new accounts to `admin`, `staff`, `supplier`, and `driver`; remove customer commerce routes from the operational navigation.
- [x] Block customer-role creation of `orders` and `order_items`, and block customer order status transitions server-side; retain legacy customer records rather than deleting them.
- [x] Keep runtime mode isolated: operational `medar-ops` uses its explicit deployment mode, while `medar-api` remains a public read-only demo.
- [x] Run current-main desktop/mobile operational and public-demo Playwright suites.

These checks establish route and API behavior in CI, but do not replace observing real owner-created accounts using the intended production session.

## Stage 3 — Authentication and tenant isolation

- [x] Public signup/invite signup fail closed in the deployed operational Worker.
- [x] Unauthenticated workspace reads and profile completion are denied; CORS rejects untrusted mutations.
- [x] CI tests the identity schema, dedicated member-account SQL, normalized usernames, migration compatibility, and representative role/tenant boundaries.
- [ ] **Owner-session acceptance:** an authorized owner must create one temporary *business-authorized* staff/supplier/driver account via the real owner UI, then verify login, session persistence, profile completion, password change, logout/session revocation, and expected permissions. Do not manufacture a production fixture account or share passwords in chat.
- [ ] **Two-real-workspace acceptance:** using authorized accounts in two real workspaces, prove that one workspace cannot read or mutate the other's suppliers, farm/production records, orders, inventory, finance, settlements, evidence metadata, or notifications.
- [ ] Review audit events and rate limits under the authorized owner-session flow.

Do not mark the real-account/tenant gate complete merely because mocked browser API tests or disposable PostgreSQL CI passed.

## Stage 4 — Critical operational workflows

CI exercises selected SQL and browser workflows, including inventory concurrency, purchase-order lifecycle, status/approval rules, notification behavior, route authorization, quality/settlement navigation, and worker API guards. Broad commercial acceptance remains open until an authorized pilot user verifies persisted records through the actual deployed interface.

- [ ] Farm/site and production cycle: lifecycle, permissions, validation, reporting, and role-scoped evidence.
- [ ] Supplier/partner and contract lifecycle: create, update, approval, and status transitions.
- [ ] Inventory and capacity: persisted stock ledger, duplicate prevention, corrections, and rollback.
- [ ] Quality inspection and incidents: saved inspection result, linked records, status transitions, and audit trail.
- [ ] Partner finance and settlements: calculation source, approvals, reconciliation, audit trail, and role-specific visibility.
- [ ] Tasks, evidence metadata, alerts and notifications: recipient scope, retries, and deduplication.
- [ ] Orders: internal staff/owner workflow end-to-end. Customer ordering is intentionally disabled and should not be presented as a supported flow.

## Stage 5 — Private files, migration, backup, and offline limits

- [ ] **Private files:** current code has a private database-backed file fallback (10 MB maximum per file) when R2 is not bound; the deploy preflight checks the storage column. Before using real business files, perform authorized upload, authorized download, unauthorized read denial, deletion, and backup/recovery tests. Configure and test R2 if larger files or expected load requires it.
- [ ] **Legacy data migration:** identify the actual source database; take a recoverable backup; test restoration; map schemas and keys; compare table counts and relationships; run a controlled dry run; obtain approval; document rollback. No Supabase-to-Neon business-data migration is claimed complete by this release.
- [ ] **Backup/recovery:** repeat the restore test with an authorized, real operational backup; disposable CI restore is not sufficient evidence of production recovery.
- [ ] **Offline:** do not promise offline writes until queuing, retries, idempotency, conflict resolution, and recovery are implemented and validated.
- [ ] **AI:** verify provider configuration and an actual approved model request only after the provider secret is configured; keys remain server-side, and financial/irreversible actions require explicit approval.

## Stage 6 — External integrations

- [x] Worker release preserves/configures VAPID secrets; the runtime can expose Push support when authenticated and correctly configured.
- [ ] **Web Push owner-session check:** verify `GET /api/push/config` using a real authorized owner session and company, confirm the public key shape, then prove an end-to-end subscription/delivery path before claiming Push delivery is accepted. The existing old PR #72 used public signup to obtain a session and is not suitable unchanged now that public signup is disabled.
- [ ] No external bank transfer, SMS OTP, email recovery, or payment-provider flow should be claimed active without provider configuration and a separate live acceptance test.

## Stage 7 — Supervised pilot decision

- [ ] Select one real workspace and a small number of authorized users.
- [ ] Define concrete daily tasks and expected persisted results before onboarding.
- [ ] Confirm backup/recovery, access boundaries, and required file behavior before real records are entered.
- [ ] Track failures, duplicate writes, confusing actions, support needs, and role-permission issues during the pilot.
- [ ] Approve broader rollout only after all critical gates above are either passed or explicitly accepted by the business owner.

## Release decision rules

- **NO-GO:** production health, authentication, tenant isolation, a critical operational workflow, or required recovery fails.
- **CONDITIONAL PILOT:** critical security/role gates pass; remaining limitations are documented and accepted; a supervised owner accepts the risks.
- **GO for broader use:** pilot succeeds, required workflows and recovery are proven, and open limitations are either fixed or formally accepted.

A code change, green CI, or demo UI alone is not evidence that the business workflow is accepted.
