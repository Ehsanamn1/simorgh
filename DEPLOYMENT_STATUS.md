# Simorgh deployment status

Checked: 2026-10-15.

## Published application

- **Live URL:** https://ehsanamn1.github.io/simorgh/
- **Latest verified runtime commit:** `058a9e74a32bdc11e56dbd23b05235d89cd05f49`.
- **Successful CI:** [Run 38769548002](https://github.com/Ehsanamn1/simorgh/actions/runs/38769548002).
- **Successful deployment:** [Run 38769835859](https://github.com/Ehsanamn1/simorgh/actions/runs/38769835859).
- Frontend uses React 19, TypeScript, Vite, React Router and custom responsive CSS. Static hosting is GitHub Pages; Vercel is not used.
- Supabase project `aoxerjimfiwusidaparx` in `eu-central-1` is connected by its Project URL and a browser-safe publishable key. The core migration created 18 app tables with RLS enabled, and the initial company `شبکه سیمرغ` exists.
- Creation of the Supabase project was confirmed at $0/month. Free-tier limits and any ancillary services remain subject to their terms/limits.

## Automated verification

On the verified runtime commit, the latest completed CI reported:

- TypeScript typecheck: **passed**
- ESLint: **passed**
- Vitest unit tests: **4 passed**
- Playwright browser tests: **21 passed** across desktop Chromium (1365×900), mobile Chromium (390×844), and compact mobile Chromium (360×800)
- Production dependency audit: **0 production vulnerabilities reported**
- Vite production build for the Pages `/simorgh/` base path: **passed**
- Deploy build and GitHub Pages deployment: **passed**

The browser suite verifies:
- Public root has no login, signup or password-reset fields/buttons.
- Manager, supplier/farm, driver/transport and customer role cards exist.
- Each role opens its own labelled structural preview and expected menu/capability.
- Direct navigation to an `/app/...` URL without a session returns the public portal, not the operational panel.
- No horizontal overflow is present at the three tested viewports.
- Covered flows have no uncaught browser exceptions.
- Four desktop role-preview screenshots are saved in the CI artifact together with the portal screenshots and Playwright HTML report.

These tests verify the public role-screening interface. They are not a security certification and do not replace role-by-role tests with real Supabase accounts.

## Public UI behavior

- The root page is a Persian RTL, motion-enhanced workspace selector.
- It has four structural previews: manager/owner Control Tower, supplier/farm partner, driver/transport contractor and organizational customer.
- Motion includes orbit rings, animated production/order/delivery/settlement nodes, section reveal and hover/focus transitions. CSS honors `prefers-reduced-motion`.
- Public login, signup and password-reset UI are disabled per the current product decision.
- Selecting a role only shows a preview; it does not create a session, grant permissions or query private operational records.
- Existing protected application routes and Supabase session/membership logic remain in source code. A verified user and valid active company membership are required to reach the real operational workspace.

## Required before real operational use

1. Create/invite the trusted first owner through a controlled Supabase Dashboard procedure. The last database check showed no registered users or owner membership.
2. When onboarding is ready, deliberately grant that verified user the first `owner` membership. Do not grant roles based on public card selection.
3. Re-enable an appropriate secure sign-in/onboarding flow before expecting users to reach the existing protected workspaces.
4. Create separate test accounts for owner/staff/customer/supplier/driver and prove negative access cases: one customer cannot read another customer; a supplier cannot view another partner; a driver cannot view unassigned jobs; IDs and URLs cannot bypass RLS.
5. Test file upload/read policies, capacity race conditions, order/shipment state transitions, required delivery evidence and adjustment/audit behavior before processing live records.

## Known product gaps from the master prompt

- Farm sites/facilities, flock cycles, daily production records, feed/mortality/egg grading measurements, task templates, scheduled tasks, task evidence and escalation flows are not fully implemented.
- No transaction-ledger inventory/procurement lifecycle exists yet.
- Existing finance tables support internal invoice/settlement state, but the contract-versioned 50/50 partnership reconciliation engine described in the master prompt is not implemented end-to-end. Bank transfers are not performed or verified.
- Driver tools are currently a partial foundation; actual GPS tracking, stale-position handling, native/background tracking validation, job acceptance, offline synchronization and carrier statements remain incomplete.
- AI agents, approval inbox, tool allowlists, run audit/history, retryable background jobs and notification delivery integrations are not configured as a complete subsystem.
- No live camera, external GPS device, SMS, payment gateway or AI provider integration is claimed as active.
- Supabase security advisors have surfaced guarded SECURITY DEFINER RPC and RLS/index recommendations. Review the function bodies and policy behavior with real roles before scaling. No independent security audit has been performed.

## Deployment pipeline and safety

- `.github/workflows/ci.yml`: typecheck, lint, unit tests, dependency audit, Pages-base build, Chromium install, responsive browser tests and test artifacts.
- `.github/workflows/pages.yml`: deployment is gated on a successful CI run.
- Optional Cloudflare Pages workflow is retained in `.github/workflows/deploy.yml`; it requires Cloudflare credentials.
- Do not put a Supabase secret/service-role key in a browser variable or commit a private key to Git.
- Do not seed mock operational records into the real production database.
