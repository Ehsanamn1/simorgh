# Simorgh — Project Handoff for a New Chat

Updated: 2026-10-15
Repository: https://github.com/Ehsanamn1/simorgh
Branch: main
Live site: https://ehsanamn1.github.io/simorgh/
Supabase project: aoxerjimfiwusidaparx
Region: eu-central-1 (Frankfurt)

## Instructions for continuing work

Use this repository as the source of truth. Inspect the current main branch, latest CI and deployment runs, then inspect the code before making changes. Preserve working behavior, use additive reviewed migrations, and run full CI plus browser tests before deployment. Do not use Vercel. The current product decision is that the public root must not show login/sign-up forms; do not re-enable them without explicit instruction. Never claim success from a mockup/build alone.

## Product and architecture

Simorgh is a Persian/RTL network-operations application for a quail egg/meat supply network. The stack is React 19, TypeScript, Vite, React Router, custom CSS, Lucide, Recharts, Supabase Auth/Postgres/Storage, GitHub Actions and GitHub Pages.

The existing data model covers companies and memberships, customers, suppliers, products, price agreements, orders/order items, capacity commitments/allocation, lots and quality reviews, shipments and delivery evidence, invoices, settlements, notifications and audit events. Core schema is in:
supabase/migrations/20261015000000_simorgh_core.sql

Frontend entry: index.html → src/main.tsx → BrowserRouter → AuthProvider → src/App.tsx.
Data access: src/lib/supabase.ts. Session/membership logic: src/lib/AuthContext.tsx.
Do not rely on hidden UI for security: Postgres RLS and guarded DB functions are the authorization boundary.

## Public UI as requested

The root route is a motion-enhanced Persian/RTL workspace portal. Public login, sign-up and password-reset UI are disabled. Four role previews exist:
1. Manager/owner Control Tower
2. Supplier/farm partner
3. Driver/transport contractor
4. Organizational customer

Cards show structure only. They do not create users, start sessions, assign permissions or expose private operational records. The actual app remains behind a valid Supabase session and active company membership. The manager preview explicitly lists user/role assignment as a managerial responsibility.

Visual direction: premium enterprise operations, forest/leaf palette, readable type scale, responsive layouts, animated supply-chain diagram, orbit rings, role cards, hover/focus transitions and prefers-reduced-motion support. Keep Persian labels readable. Do not add invented KPIs, demo customers or fake orders to production Supabase.

## Current infrastructure

- GitHub repository: Ehsanamn1/simorgh, default branch main.
- Live URL: https://ehsanamn1.github.io/simorgh/
- Static build uses base path /simorgh/ and BrowserRouter reads import.meta.env.BASE_URL.
- Supabase URL: https://aoxerjimfiwusidaparx.supabase.co
- Only the publishable key is allowed in the browser. Never put service-role/secret keys in source, VITE variables, issues, or chat.
- Supabase project creation was confirmed at $0/month. This does not guarantee every future service or usage above free-tier quotas will be free.
- Core migration has 18 app tables with RLS enabled; initial company row شبکه سیمرغ exists.
- Last confirmed successful CI before adding the export workflow: https://github.com/Ehsanamn1/simorgh/actions/runs/38771300163
- Last confirmed successful Pages deployment before adding the export workflow: https://github.com/Ehsanamn1/simorgh/actions/runs/38771546904
- These results were for commit 1508366f791d8adef55e267fb0fb7cf1887b7b91. This handoff/export commit advances main; check the latest Actions list for results on the new HEAD.

## Automated checks previously confirmed

The successful CI for the role-portal implementation reported:
- TypeScript typecheck passed.
- ESLint passed.
- Vitest: 4 unit tests passed.
- Playwright: 27 tests passed in Chromium at desktop 1365×900, mobile 390×844 and compact mobile 360×800.
- Production dependency audit: 0 production vulnerabilities reported.
- Vite build with GitHub Pages base path: passed.
- GitHub Pages deployment: passed.

Browser coverage includes public role cards, no auth form on root, role-specific preview content/navigation, unauthenticated direct operational route redirect, responsive horizontal overflow and uncaught browser exceptions. These tests verify UI regression behavior; they are not a penetration test and do not prove real-account access policies.

Commands:
npm install
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
npm run build:pages
npm run test:e2e

Node.js 22+ is used in CI. Keep package-lock.json. CI installs Chromium for Playwright.

## Unresolved items — do not conceal these

1. Owner bootstrap: the last database check showed no Auth users and no active owner membership. Create/invite the first trusted owner through a controlled Supabase Dashboard procedure, then grant that verified user the owner membership for شبکه سیمرغ. Public role-card clicks must never assign roles.
2. Auth UX: public login/onboarding forms remain disabled by the current decision. Before staff/partners can use protected panels, decide on a controlled sign-in/onboarding flow, implement it safely, and test redirects/session restoration.
3. Authorization: create separate test accounts for owner, staff, customer, supplier and driver. Test negative RLS cases (one customer cannot read another, suppliers cannot read partners, drivers cannot read unassigned shipments, guessed IDs/URLs cannot bypass membership).
4. Supabase advisor warnings: review guarded SECURITY DEFINER RPC functions and RLS/index recommendations with role-specific negative tests. RLS enabled does not equal an independent security certification.
5. Farm production modules missing/partial: farm/site records, flock cycles, daily production, feed/mortality/egg grading measures, task templates/scheduling/evidence/escalations are incomplete.
6. Inventory/procurement: no complete stock ledger, goods-receipt, reservation, purchase workflow or feed-use records.
7. Finance: invoices/settlements track internal status, not bank movements. The requested contract-versioned 50/50 partnership profit/loss reconciliation, reversals, expense approvals, bank verification and reconciled partner statements are not implemented end-to-end.
8. Logistics: driver/shipment foundations exist, but real GPS integration, stale-location handling, background tracking, offline sync, job acceptance and contractor statements are incomplete.
9. Evidence/integrations: test private Storage upload/read with real roles. No live camera, GPS hardware, payment gateway, SMS, external ERP or AI-provider integration is claimed active.
10. Security: do not use the system for live invoices/settlements/stock commitments until role authorization and business workflows have been tested with controlled accounts.

## Recommended continuation order

1. Check current main, live site, and latest CI/deploy results. Verify final bundle commit and deployment.
2. Read README.md, DEPLOYMENT_STATUS.md, docs/PRODUCT_AUDIT.md, this file, the SQL migration and role workspace components.
3. Fix browser/UI regressions first; keep Playwright desktop/mobile/compact-mobile tests and inspect screenshot/trace artifacts when tests fail.
4. Implement safe owner provisioning and role assignment without making the public preview an authorization path.
5. Test tenant isolation and negative RLS with distinct test accounts.
6. Add production, inventory, finance and logistics capabilities via reviewed additive migrations and auditable workflows.
7. Add AI only after operational data and permissions are reliable; use allowlisted tools, logs and human approvals for financial/external actions.

## Useful files

- README.md: setup and operating cautions.
- DEPLOYMENT_STATUS.md: deployment and validation status.
- docs/PRODUCT_AUDIT.md: architecture, gaps, UI audit and priorities.
- supabase/migrations/20261015000000_simorgh_core.sql: schema, policies and SQL functions.
- src/App.tsx: public portal and current role-specific application views.
- src/styles.css: design system, responsive layout and motion.
- src/lib/AuthContext.tsx: Supabase session and memberships.
- src/lib/supabase.ts: browser Supabase setup.
- e2e/ and playwright.config.ts: browser simulation.
- .github/workflows/ci.yml: verification pipeline.
- .github/workflows/pages.yml: deployment gated on successful CI.
- .github/workflows/deploy.yml: optional Cloudflare Pages workflow, requires Cloudflare secrets.

## Source-of-truth rules

Keep credentials private. Do not seed fake rows in the production database. Do not claim bank/GPS/AI/SMS/camera integration without a successful integration test. Use the existing repository and current main; do not reconstruct the project from snippets. Keep GitHub Pages unless the user explicitly requests another host.
