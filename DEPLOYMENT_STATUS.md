# Simorgh deployment status

Checked: 2026-10-15.

## Current public UI

- Site URL: https://ehsanamn1.github.io/simorgh/
- The public root is a Persian RTL role-selection portal. It intentionally has **no login, sign-up or password-reset form** at the user's current request.
- The four role previews are: manager/owner Control Tower, supplier/farm partner, driver/transport contractor, and organizational customer. Clicking a card changes the preview only; it does not grant a role, create an account, or load private records.
- The actual operational routes and authenticated Supabase session/membership logic remain in the source. With no valid session and membership, these previews are not operational workspaces.

## Infrastructure verified previously

- Repository: https://github.com/Ehsanamn1/simorgh, branch `main`.
- Supabase project `aoxerjimfiwusidaparx`, region `eu-central-1`, URL `https://aoxerjimfiwusidaparx.supabase.co`.
- Core migration `20261015000000_simorgh_core.sql` applied successfully. 18 application tables have RLS enabled; initial company `شبکه سیمرغ` exists.
- Project creation cost was confirmed at $0/month at the time of creation; free-tier quotas and ancillary services may still have separate limits/charges.
- No operational customer, supplier, order, shipment, or financial sample rows were intentionally seeded.
- A previous version was successfully deployed at https://ehsanamn1.github.io/simorgh/; a current version is deployed only after its own CI run succeeds.

## Latest role-portal checks

- CI: TypeScript typecheck, lint, Vitest, production npm audit, and GitHub Pages base-path build have passed in recent runs.
- A previous browser run failed because the portal root was held behind auth/session loading and the test could not see the role page. The loading gate was removed so the public portal does not wait for session restoration. The new CI/browser result must be checked before claiming the new portal is verified or deployed.
- Playwright runs in three Chromium viewports (desktop 1365×900, mobile 390×844, compact mobile 360×800). It checks no auth inputs on the public root, role preview navigation/capabilities, no horizontal overflow, and browser exceptions. It does not create records in live Supabase.

## Remaining before operational use

- No registered user or owner membership was present at the last database check. Login/signup UI is intentionally disabled; create/invite the trusted owner through a controlled Supabase Dashboard procedure when account onboarding is ready.
- Owner membership must be granted deliberately to the verified account; role cards never assign it.
- Validate the manager member-assignment flow and row-level access using separate owner, staff, customer, supplier, and driver accounts before exposing real workspaces.
- Review Supabase security/performance advisor findings (guarded SECURITY DEFINER RPCs, RLS query planning and index recommendations) and verify the function bodies/policies with negative access tests.
- Storage evidence access, order/capacity concurrency, source-to-delivery traceability, and role boundaries are not independently security-audited.
- Financial pages currently record internal ledger/invoice/settlement states, not bank movements. A complete contract-versioned 50/50 partnership profit/loss engine, farm site/flock/task modules, inventory/procurement ledger, live GPS/camera/AI providers, and external notifications are not implemented or not configured.
- Never publish a Supabase secret/service-role key in a browser variable or commit private credentials.

## Deployment pipeline

- `.github/workflows/ci.yml`: typecheck, lint, unit tests, production audit, Pages-base build, Chromium installation, responsive browser tests, report artifact.
- `.github/workflows/pages.yml`: deploys only after successful CI.
- Optional Cloudflare Pages workflow remains in `.github/workflows/deploy.yml` and requires Cloudflare-specific repository secrets.
