# Simorgh deployment status

Checked: 2026-10-15. Current verified commit: c5c971011b2ba6132527f34519d9b7e5405de22e.

## Latest deployment and CI results

- **Live URL:** https://ehsanamn1.github.io/simorgh/
- **Latest successful deployment:** [GitHub Actions run 38757731921](https://github.com/Ehsanamn1/simorgh/actions/runs/38757731921) — completed successfully on the current commit.
- **Latest successful CI:** [GitHub Actions run 38757452211](https://github.com/Ehsanamn1/simorgh/actions/runs/38757452211) — typecheck, lint, unit tests, production audit, GitHub Pages base-path build and all browser tests passed.
- Vitest: **4 passed**.
- Playwright: **18 passed** across desktop Chromium (1365×900), mobile Chromium (390×844), and compact mobile Chromium (360×800).
- Production dependency audit: **0 vulnerabilities reported**.
- Production build: successful for the /simorgh/ base path.
- UI tests confirm the public entry has no login/sign-up/password fields, all four role previews render, preview navigation works, no horizontal overflow occurs at the tested widths, and no uncaught browser exceptions occurred in the covered flows. This is not a security certification.

## Current public UI

- The root is a Persian RTL role-selection portal with motion and mobile layouts.
- Four visible role previews: manager/owner, farm/supplier partner, driver/transport contractor, and organizational customer.
- Selecting a role is a screening/preview action only. It does not authenticate a user, grant access, or query private operational records.
- Public login, sign-up and password-reset forms are intentionally disabled per product direction. /auth redirects to the public root.
- The authenticated app, Supabase Auth/session provider, role-filtered route definitions and data layer remain in source, but new operational sessions cannot be initiated from the public UI while auth forms are disabled.

## Infrastructure verified previously

- Repository: https://github.com/Ehsanamn1/simorgh, branch main.
- Supabase project aoxerjimfiwusidaparx, region eu-central-1, URL https://aoxerjimfiwusidaparx.supabase.co.
- Core migration 20261015000000_simorgh_core.sql applied. 18 application tables have RLS enabled; initial company شبکه سیمرغ exists.
- Project creation cost was confirmed as $0/month at creation time; free-tier quotas and ancillary services still have their own limits/policies.
- No operational customer, supplier, order, shipment, or financial sample rows were intentionally seeded.

## Remaining before operational use

- Create/invite the trusted first owner through a controlled Supabase Dashboard process and grant the owner membership deliberately; no owner membership was present in the last database check.
- Re-enable a deliberate authentication/onboarding path only when the owner is ready to use it. Do not use role previews as operational workspaces.
- Run role-isolation tests with separate owner, staff, supplier/farm partner, driver, and customer test accounts. Test direct REST/RPC calls and changing object IDs, not just front-end visibility.
- Review Supabase security/performance advisor findings (guarded SECURITY DEFINER RPCs, RLS query planning and index recommendations), verify function bodies, and test unauthorized callers.
- Verify private Storage access by role, evidence upload/download and retention.
- Complete the contract-versioned 50/50 partnership reconciliation engine; current finance UI records internal ledger/invoice/settlement states and does not move or verify bank funds.
- Add the missing farms/facilities, flock cycles, production batches, task scheduling/evidence, stock transaction ledger/procurement and contract amendment modules before replacing daily business records.
- Complete transport acceptance/dispatch, assigned trips, pickup/delivery evidence, discrepancy handling and device-verified GPS. Do not claim live GPS/camera integrations unless configured and tested.
- Bounded AI agents, tool allowlists, execution logs, approvals, scheduled jobs and notification retries are not implemented as full working integrations yet.
- No independent security audit has been performed. Never publish a Supabase secret/service-role key in a browser variable or commit private credentials.

## Deployment pipeline

- .github/workflows/ci.yml: typecheck, lint, Vitest, production audit, Pages-base build, Chromium browser simulation and artifact upload.
- .github/workflows/pages.yml: static GitHub Pages deployment; the most recent run above completed successfully.
- Optional Cloudflare Pages workflow remains in .github/workflows/deploy.yml and requires Cloudflare-specific repository secrets.