# Simorgh / Medar — Release and deployment status

Checked: 2026-10-17.

## Live application surfaces

- **Public showcase on GitHub Pages:** https://ehsanamn1.github.io/simorgh/
- **Public showcase served by the Cloudflare Worker:** https://medar-api.dengxiao445.workers.dev/
- **Worker health endpoint:** https://medar-api.dengxiao445.workers.dev/api/health
- **Current verified application-code release:** `eb5074b73f1f6cb2b8a3a2b470691f95af04c350`.

The public deployments intentionally use `VITE_ENABLE_AUTH_UI=false`. They show the read-only demo workspace rather than exposing the private operations workspace to anonymous visitors. In these builds, `/app/*` redirects to `/demo`; choosing a demo navigation item does not grant access or make a real business mutation. The private API still requires an authenticated session and checks workspace membership and role.

The operational UI with sign-in enabled is separately built and checked by CI, but it is **not the default public experience** until owner onboarding and role-based launch checks are deliberately completed. Do not describe the public demo as a fully onboarded production tenant.

## Verified automation for the current release

- **CI — green:** [Run 39027287316](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287316)
- **GitHub Pages build and publish — green:** [Run 39027287184](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287184)
- **Cloudflare Worker deploy and live smoke tests — green:** [Run 39027287175](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287175)
- **Android debug APK — green:** [Run 39027287214](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287214)
- **iOS Simulator app — green:** [Run 39027287248](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287248)
- **Complete source bundle — green:** [Run 39027287251](https://github.com/Ehsanamn1/simorgh/actions/runs/39027287251)

The current CI pipeline verifies TypeScript, ESLint, unit tests, production dependency audit, the canonical migrations against a clean PostgreSQL 16 database, the authentication-enabled build, the Cloudflare root-asset build, the GitHub Pages subpath build, and desktop/mobile browser checks. The live Worker workflow validates the established Neon Medar schema, applies compatible versioned migrations, checks required RPC signatures, deploys, tests live assets and SPA routes in Chromium, and confirms unauthenticated/invalid-origin API requests are rejected. The Pages workflow publishes on successful main-branch builds and checks the deployed assets and desktop/mobile interactions.

These are code, build, deployment, and smoke-test results. They are not an independent security audit or proof that every business workflow has been validated end-to-end with real tenant accounts.

## UI and UX changes

- Added `src/premium-polish.css`, imported after the main design system so the visual overrides stay isolated and maintainable.
- Refined dark surfaces, teal accents, borders, shadow depth, typography hierarchy, search and form focus states, buttons, tables, empty states, and dialogs.
- Improved the command-center metric cards, quick-access panel, freshness indicator, goals and alerts, including responsive grids at tablet and mobile widths.
- Added specific light-theme legibility overrides, keyboard focus visibility, and reduced-motion handling.
- Kept sample operational data out of the real database. Any showcase data is displayed only inside the explicitly identified demo workspace.

## Operational API and database status

The Cloudflare Worker is deployed and connected to the established Neon Medar database. Its deployment workflow validates the existing Medar tables before applying only compatible versioned migrations (`0007_existing_medar_schema_compat.sql` and `0008_operational_task_actions.sql`), verifies the required RPC signatures, and then runs live authorization smoke tests. It intentionally refuses to replay the fresh-database chain over a database that does not pass the established-schema checks.

A successful schema/deployment check **does not establish that all legacy Supabase business rows were migrated to Neon**. A complete source-to-target export/import with backups and row-count reconciliation remains unverified; do not assume legacy records have been copied.

## Known limits — not marked complete

1. **Private file storage:** Cloudflare R2 is intentionally left disabled in the current workflow. There is no `FILE_STORE` binding in the deployed Worker config, so private file upload/read/delete endpoints remain unavailable and return HTTP 503. The recent deployment attempt confirmed the account/token could not provision R2; the workflow now keeps it disabled rather than claiming storage works.
2. **Operational onboarding:** The public build is a read-only showcase. Before exposing the operational UI, create or verify the trusted first owner, validate a real owner membership, and test distinct owner/admin/staff/customer/supplier/driver accounts and denial cases against the live database.
3. **Legacy-data migration:** Supabase-to-Neon operational row migration and source/target reconciliation have not been independently confirmed.
4. **Business modules with remaining work:** Full transaction-ledger inventory/procurement; end-to-end contract-versioned 50/50 partner settlement reconciliation; complete farm/flock-cycle and daily production evidence workflows; escalations and notification delivery; full driver job assignment, background GPS and offline synchronization; and AI-agent/approval/background-job integrations are not all verified as complete end-to-end.
5. **External transactions and devices:** No real bank transfers, payment gateway, SMS delivery, camera workflow, external GPS device, or AI provider integration is claimed active. Internal invoice/settlement status does not itself prove that a payment happened.
6. **Mobile artifacts:** CI produces an unsigned Android debug APK and an unsigned iOS Simulator app. These are build artifacts, not signed app-store releases.

## Safe release rule

Keep the public showcase separate from private operational records. Do not enable the live sign-in UI or mark a module complete solely because a button or page exists. Require working server-side authorization, real persisted data, positive and negative role tests, responsive UI checks, and a successful deployment before calling an operational capability production-ready.
