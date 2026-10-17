# Simorgh / Medar — Release and deployment status

Checked: 2026-10-17.

## Live application surfaces

- **Worker demo (interactive, read-only showcase):** https://medar-api.dengxiao445.workers.dev/
- **Public read-only showcase (not the operational tenant):** https://ehsanamn1.github.io/simorgh/
- **Worker health endpoint:** https://medar-api.dengxiao445.workers.dev/api/health
- **Current verified application-code release:** `0dd1fa068f5e08be27194976e498544a7236c81a`.

The Cloudflare Worker is configured to serve the interactive, read-only `DemoWorkspace` with `VITE_ENABLE_AUTH_UI=false`, so a company can inspect the product without logging in. All displayed business records and metrics are explicitly marked as sample data; navigation, search, responsive layout and the live health check are interactive. The sign-in and registration code remains in the source, but is not shown in showcase builds. This switch is a UI-only choice: protected API routes still require a valid server session and do not grant demo visitors a real company membership.

GitHub Pages and the Android/iOS showcase builds use the same read-only demo mode. Sample records are local display fixtures, not production company data; no order, payment, delete or operational write is enabled from the public demo.

## Verified automation for the current release

- **CI — green:** [Run 39035424341](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424341)
- **GitHub Pages publish and live browser smoke — green:** [Run 39035424336](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424336)
- **Cloudflare Worker deploy and live sign-in/API smoke — green:** [Run 39035424329](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424329)
- **Android debug APK with operational auth bundle — green:** [Run 39035424337](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424337)
- **iOS Simulator app with operational auth bundle — green:** [Run 39035424353](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424353)
- **Complete source snapshot — green:** [Run 39035424436](https://github.com/Ehsanamn1/simorgh/actions/runs/39035424436)

The current CI pipeline checks TypeScript, ESLint, unit tests, production dependency audit, the canonical migration chain against clean PostgreSQL 16, the concurrent stock-deduction invariant, purchase-order approval/partial/final receipt and over-receipt rejection, the auth-enabled build, Pages subpath build, and desktop/mobile browser checks.

The Worker deployment flow validates the established Neon schema before applying checksummed compatibility migrations, verifies required RPC signatures and the migration ledger, deploys to Cloudflare, fetches every emitted JS/CSS asset, verifies the public demo assets and SPA deep links, then renders the dashboard in Chromium on desktop and mobile. The browser smoke test checks navigation, sample-data notice, no sign-in UI, horizontal overflow, live Worker/database health, and client-side runtime errors. Separate API checks continue to verify unauthenticated access denial and the invalid-origin mutation guard. GitHub Pages performs its own asset and desktop/mobile demo checks.

These are source, build, deployment, and smoke-test results. They are not an independent penetration test or proof that all business workflows have been validated end-to-end using a fully onboarded live company.

## Onboarding and first production workspace

A read-only query on the Worker-connected Neon branch after deployment reported **0 active users, 0 active owner memberships, 4/4 compatible migration records (0007–0010), the purchase-order receipt RPC present, and 0 purchase orders**. No owner or test company was seeded by this release. This keeps production data honest and isolated.

During this presentation phase, the Worker URL opens the public read-only demo and intentionally does not show sign-in or registration. The demo does not create or access a real company workspace. When operational onboarding is ready to resume, build a trusted operational release with `VITE_ENABLE_AUTH_UI=true`; then create the first workspace using the owner's own mobile number, username and password and test each role with real accounts. Never add a shared default password or bypass the server's session checks.

## Verified procurement slice

Migration `0010_purchase_order_lifecycle.sql` adds tenant-scoped purchase-order headers/lines plus server-only RPCs for draft creation, owner/admin approval and partial/final receipt. Receipts post inventory movements in the same transaction and write audit events. PostgreSQL CI verifies that two overlapping stock deductions cannot oversell, partial receipt followed by final receipt updates the ledger correctly, and receiving beyond the ordered quantity is rejected.

This is a verified purchase-order-to-inventory slice; it does not by itself complete the whole ERP or validate a real supplier's commercial delivery.

## UI and UX changes

- Added `src/premium-polish.css`, isolated after the design system.
- Refined dark surfaces, teal accents, borders, shadows, typography hierarchy, search/focus states, buttons, tables, empty states, forms and dialogs.
- Improved command-center cards, quick-access navigation, freshness indicator, goals/alerts and responsive grids.
- Added light-theme contrast rules, visible keyboard focus and reduced-motion handling.
- Made the read-only showcase the visible experience on Worker and mobile builds, while retaining server-enforced authentication and the dormant sign-in/registration UI for a later controlled re-enable.

## Operational API and database status

The Worker is deployed and connected to the established Neon Medar database. Deployment applies only the checksummed compatible migration chain `0007_existing_medar_schema_compat.sql` through `0010_purchase_order_lifecycle.sql`; it never replays the fresh-database base chain over the established production database.

A successful schema/deployment check **does not establish that all legacy Supabase business rows were migrated to Neon**. A complete source-to-target export/import with backups and row-count reconciliation remains unverified; do not assume legacy operational records have been copied.

## Known limits — not marked complete

1. **Private file storage:** Cloudflare R2 is intentionally left disabled. No `FILE_STORE` binding is present, so private file upload/read/delete endpoints remain unavailable and return HTTP 503.
2. **Production onboarding validation:** The initial signup UI was verified in CI and on the live Worker without creating a live user. First-owner signup and subsequent invitation acceptance should be exercised with the real owner's account, followed by role tests for owner/admin/staff/customer/supplier/driver. Do not use fake/shared accounts.
3. **Legacy-data migration:** Supabase-to-Neon business row migration and source/target reconciliation remain unconfirmed.
4. **Business modules with remaining work:** Full end-to-end inventory/procurement accounting beyond the verified PO receipt slice; complete contract-versioned 50/50 partner settlement reconciliation; full farm/flock-cycle and daily-production evidence workflows; escalations/notification delivery; driver job assignment, background GPS and offline synchronization; and AI-agent/approval/background-job integrations are not all verified end-to-end.
5. **External transactions and devices:** No real bank transfer, payment gateway, SMS delivery, camera workflow, external GPS device, or AI provider is claimed active. An internal invoice/settlement status is not proof of a real payment.
6. **Mobile artifacts:** CI creates an unsigned Android debug APK and an unsigned iOS Simulator app. They are build artifacts, not signed Play Store/App Store releases.

## Safe release rule

Keep the public showcase separate from private operational records. Do not mark a capability production-ready merely because a button or page exists. Require server-side authorization, real persistence, positive and negative role tests, responsive UI verification and successful deployment before calling each operational workflow complete.
