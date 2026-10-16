# Simorgh — Acceptance Checklist

**Checked:** 2026-10-16  
**Active implementation:** [PR #10 — Manager control tower, generic farm schema and secure access](https://github.com/Ehsanamn1/simorgh/pull/10)  
**Baseline successful deployment:** [Run 38757731921](https://github.com/Ehsanamn1/simorgh/actions/runs/38757731921)  
**Live site:** https://ehsanamn1.github.io/simorgh/

This checklist reflects the current repository and the connected Supabase project. The baseline deployment predates PR #10; the current branch must pass CI and deploy before its UI changes are considered live.

## A. Implemented in the current product iteration

- [x] Keep the React + TypeScript + Vite, React Router and Supabase architecture.
- [x] The public route opens a Persian RTL operational shell; it does not present a fake role selector or auto-open sign-in.
- [x] Add an explicit sign-in/password-recovery entry for previously provisioned accounts; public self-registration and self-assigned roles remain disabled.
- [x] Authenticated members enter the real role-filtered workspace, with responsive mobile navigation based on their actual membership role.
- [x] The manager workspace contains the real order, goal, partner, inventory, capacity, quality, logistics, finance, farm, production, task, incident and audit modules.
- [x] Add a manager-map panel that reads active farm sites from Supabase and only places markers for saved latitude/longitude pairs.
- [x] Generalize site type, production-cycle type, batch kinds, universal daily inputs/outputs/losses and measurement units beyond quail/poultry; retain legacy columns for compatibility.
- [x] Track the existing general_farm_management migration and the follow-up generalize_farm_operations migration in Git; apply the follow-up to the connected Supabase project.
- [x] Keep the Persian RTL UI, Vazirmatn typography, accessible focus states, dark/light theme and compact mobile navigation.
- [x] Add Playwright coverage for the secure sign-in entry, generic farm forms, mobile layout and the absence of invented farm-map markers.
- [ ] Pass the latest CI for PR #10 and verify the post-merge GitHub Pages deployment before calling this iteration released.

**Live database check (2026-10-16):** one company record exists, but there are zero Supabase Auth users, zero active memberships and no operational records in the sampled core tables. Thus the authenticated owner dashboard and real company data cannot be exercised until the first trusted owner is provisioned.

## B. Required before real operational use

- [ ] Create/invite the trusted first owner through a controlled Supabase Dashboard process.
- [ ] Deliberately grant and verify the first owner membership for شبکه سیمرغ.
- [x] Add a secure sign-in entry and password-recovery UI for provisioned accounts; public self-registration remains disabled.
- [ ] Verify actual Supabase login/session, sign-out, email verification and password recovery with provisioned test accounts.
- [ ] Test RLS and API/RPC authorization with separate owner, staff, supplier, driver and customer test accounts.
- [ ] Prove that a customer cannot read another customer's order; a supplier cannot read another farm's private records; a driver cannot access an unassigned trip; and direct ID changes do not bypass access checks.
- [ ] Verify private Storage upload/download and signed access with role-specific test accounts.
- [ ] Inspect and review Supabase security advisor findings concerning guarded SECURITY DEFINER RPCs, RLS planning and indexes.
- [ ] Load operational records only after a controlled non-production test; never use the public previews as operating workspaces.

## C. Core product requirements still missing or partial

### Completed in the 2026-10-16 iteration
- [x] Track the production `general_farm_management` schema in Git and apply a follow-up migration to the connected Supabase project.
- [x] Generalize farm unit types, production cycle types, production kinds, universal daily inputs/outputs/losses, optional geographic coordinates, and rejected quantity while retaining legacy columns for compatibility.
- [x] Add a live-data manager map that renders only persisted farm-site coordinates and clearly prompts for coordinates when none are registered.
- [x] Add a visible secure login entry for pre-provisioned accounts; keep public self-registration disabled.
- [x] Add browser coverage for generic farm form options and reject invented map pins.
- [ ] Create the trusted first owner before the authenticated manager panel can be used; the connected project currently has zero Auth users and zero active memberships.

### Phase 1 — operational integrity
- [x] General farm-site records, license fields, and site coordinates; generic cycle/batch categories and daily production input/output/loss records are in the application and schema.
- [ ] Validate full end-to-end workflows with real owner/member accounts, site/production data, and versioned partner contracts/amendments; incoming livestock and species-specific inspection details still need sector-specific workflow design.
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