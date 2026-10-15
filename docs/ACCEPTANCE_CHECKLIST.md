# Simorgh — Acceptance Checklist

**Checked:** 2026-10-15
**Release commit:** c5c971011b2ba6132527f34519d9b7e5405de22e
**Latest successful CI:** [Run 38757452211](https://github.com/Ehsanamn1/simorgh/actions/runs/38757452211)
**Latest successful deployment:** [Run 38757731921](https://github.com/Ehsanamn1/simorgh/actions/runs/38757731921)
**Live site:** https://ehsanamn1.github.io/simorgh/

This checklist follows the Simorgh master product/architecture prompt. It distinguishes a deployed, verified public role-screening UI from unfinished operational workflows. Passing these checks does not imply operational readiness or a full security audit.

## A. Passed — public role-screening release

- [x] Preserve existing React + TypeScript + Vite, React Router and Supabase architecture.
- [x] Public root opens a Persian RTL role-selection experience.
- [x] Login, sign-up and password-reset forms are absent from the public root, as requested.
- [x] /auth redirects to the public root.
- [x] Distinct manager/owner, farm/supplier partner, driver/transport contractor and customer role cards are visible.
- [x] Each role can open a structural navigation/capability preview.
- [x] Role selection does not grant a role, create a session, write data or fetch private business records.
- [x] Motion design includes animated supply-chain nodes, orbit/flow motion, section reveals and hover/focus feedback.
- [x] Reduced-motion preference is respected in CSS.
- [x] Playwright passed in desktop 1365×900, mobile 390×844 and compact mobile 360×800.
- [x] Responsive checks found no horizontal overflow in the tested flows.
- [x] Vitest: 4/4 passed.
- [x] Playwright: 18/18 passed.
- [x] TypeScript typecheck and ESLint passed.
- [x] Production dependency audit reported zero vulnerabilities.
- [x] Production build for GitHub Pages base path /simorgh/ passed.
- [x] Latest deployment action completed successfully.

## B. Required before real operational use

- [ ] Create/invite the trusted first owner through a controlled Supabase Dashboard process.
- [ ] Deliberately grant and verify the first owner membership for شبکه سیمرغ.
- [ ] Reintroduce a deliberate authentication/onboarding path when the owner requests activation; forms are intentionally disabled right now.
- [ ] Verify login/session behavior, sign-out, email verification and password recovery once those UI flows are enabled.
- [ ] Test RLS and API/RPC authorization with separate owner, staff, supplier, driver and customer test accounts.
- [ ] Prove that a customer cannot read another customer's order; a supplier cannot read another farm's private records; a driver cannot access an unassigned trip; and direct ID changes do not bypass access checks.
- [ ] Verify private Storage upload/download and signed access with role-specific test accounts.
- [ ] Inspect and review Supabase security advisor findings concerning guarded SECURITY DEFINER RPCs, RLS planning and indexes.
- [ ] Load operational records only after a controlled non-production test; never use the public previews as operating workspaces.

## C. Core product requirements still missing or partial

### Phase 1 — operational integrity
- [ ] Farm sites, facilities, licenses and versioned partner contracts/amendments.
- [ ] Flock cycles, production batches, incoming birds, daily production, feed consumption, mortality and egg grading records where applicable.
- [ ] Task templates, scheduling, assignees, due dates, required evidence, review and escalation history.
- [ ] Inventory transaction ledger, reservations, goods receipts, purchasing and supplier pricing history.
- [ ] Complete contract-versioned 50/50 partnership financial engine, separating expenses incurred/approved/paid/allocated, invoiced revenue/collected cash, advances, amounts owed, adjustments and actual settlements.
- [ ] Server-validated order/stock/capacity workflows with concurrency and idempotency checks.
- [ ] Source-to-destination traceability joining production lots, quality evidence, orders and delivered shipments.

### Phase 2 — logistics and evidence
- [ ] Carrier/transport agreements, drivers, vehicles and rate schedules.
- [ ] Assigned transport jobs, accept/decline, pickup, in-transit, delivery and authorized state transitions.
- [ ] Proof of pickup/delivery, discrepancies, returns, incidents, transport invoices and freight-cost allocation.
- [ ] Verified device-level GPS observations with timestamp, accuracy, permission handling and stale-location indicators. Browser route UI alone is not proof of GPS integration.
- [ ] Offline-aware mobile capture and safe synchronization where feasible.

### Phase 3 — AI operations
- [ ] Bounded agents for farm operations, production/quality, logistics, finance, procurement and executive intelligence.
- [ ] Explicit tool allowlists with server-side authorization; no arbitrary SQL, unrestricted writes or secret exposure.
- [ ] Agent run logs, structured outputs, errors/retries, source references and execution permissions.
- [ ] Human approval for financial commitments, contract changes and external actions.
- [ ] Idempotent job processing and visible failed-notification/failed-agent states.

### Phase 4 — intelligence and scale
- [ ] Reliable historical data before forecasting or predictive metrics.
- [ ] Exception-first dashboards, exportable reports, capacity planning and procurement optimization backed by source records.
- [ ] Monitoring, backups/recovery drills, role-reviewed audit trails and a security review.

## D. Release scope

The current site is deployed and the public role-screening UI is automated-test verified. The role cards are not operational application sessions. No claim is made that real account authorization, GPS, cameras, banking, SMS/transactional messages, or AI providers are currently working. Do not enter live commercial operations until section B is complete and the applicable section C workflows are built and tested.