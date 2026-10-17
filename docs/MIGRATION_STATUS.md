# مدار — Migration checkpoint: Cloudflare Workers + Neon

Updated: 2026-10-16

## Verified baseline

- Main HEAD: `1cc5c5413e0d90c430b72162e358d16f57cf06c6`
- The commit adds self-service signup and `create_company_workspace`, but both are still implemented through Supabase Auth/Postgres.
- GitHub Actions CI run `38924263909` and Pages deployment run `38924558958` both succeeded for that HEAD.
- The published application is still GitHub Pages. This is not evidence of a Cloudflare Worker backend.
- Supabase is still present in the frontend dependency graph and runtime data/auth path.

## Migration boundary

The target runtime is:

`React/Vite SPA -> Cloudflare Worker API -> Neon PostgreSQL`

GitHub remains the source of truth and CI/deployment automation. Vercel is not part of the target architecture.

The migration is intentionally staged. Supabase must remain available until the replacement authentication, authorization, data access and production smoke tests are proven.

## Repository inventory

Known Supabase coupling from the current source:

- `@supabase/supabase-js` in `package.json`
- `src/lib/supabase.ts`
- `src/lib/AuthContext.tsx`
- direct Supabase data access in `src/App.tsx`, `src/ProductExperience.tsx`, and `src/OperationsPages.tsx`
- Supabase Auth/metadata signup and workspace provisioning in `src/ProductExperience.tsx`
- SQL migrations under `supabase/migrations/`
- policies/functions using `auth.uid()` and Supabase-specific `SECURITY DEFINER` patterns
- CI/Pages/Cloudflare build configuration containing Supabase browser configuration

This inventory is not a claim that every SQL migration can be executed unchanged on Neon.

## First implementation seam

A small browser API client is introduced separately from the existing Supabase path. It is deliberately not wired into the application yet. This gives the migration a single HTTP boundary for the eventual Worker API without changing current authentication behavior.

The client:

- uses same-origin requests by default;
- sends cookies with `credentials: include`;
- never accepts or embeds server secrets;
- parses JSON responses consistently;
- exposes HTTP errors without leaking response bodies into logs.

The next implementation step should replace the auth/session path behind this boundary, beginning with `/api/health` and `/api/auth/me`, then signup/login/logout and workspace provisioning.

## Safety gates

Do not:

1. remove Supabase before replacement E2E passes;
2. migrate or delete production data without a verified backup and rollback plan;
3. trust `company_id` or `role` supplied by the browser;
4. place Neon credentials, session secrets, email-provider credentials or Cloudflare API credentials in Vite variables;
5. claim a Cloudflare deployment until a real Worker URL responds and is smoke-tested.


## 2026-10-16 implementation checkpoint

- Created Neon project `medar` in `aws-eu-central-1` and enabled Managed Neon Auth (Better Auth).
- Managed Auth base/JWKS are configured for the new Worker integration; no secret values are committed.
- Added Worker JWT verification, `/api/auth/me`, workspace membership read, workspace provisioning, and access-request endpoints.
- Added Worker Assets SPA hosting configuration and a GitHub Actions Cloudflare deployment workflow.
- Frontend authentication is now routed through Neon Auth; the legacy Supabase data client remains temporarily because operational pages still contain direct table/RPC/storage calls. It must not be removed until the data API migration is complete.
- The Neon project currently has no application rows. Existing production data has not been copied or deleted.
- Neon SQL mutation was not applied automatically from this session; schema creation therefore remains a gated migration task and the Worker data endpoints are not production-ready until the schema and Cloudflare secrets are configured and smoke-tested.

- Neon project: `weathered-shadow-56159151` (region `aws-eu-central-1`); migration branch: `br-divine-sun-ba4ib9rw`.

## Latest implementation checkpoint — 2026-10-16

- Neon migration branch `br-divine-sun-ba4ib9rw` was verified as ready.
- Foundation schema was applied to the isolated Neon migration branch; no production/main data was modified.
- Signup now requires and normalizes an Iranian mobile number (`09...` / `+98...`) and stores it in the profile metadata path.
- Neon Auth on the migration branch is Better Auth. Current managed Neon Auth does not expose arbitrary Better Auth plugins/custom server handlers; therefore SMS OTP/phone-only authentication is **not falsely marked complete**. A real Iranian SMS provider credential and a supported server-side OTP integration are required before enabling phone OTP login.
- The Worker JWKS configuration was corrected to the migration branch's actual Neon Auth endpoint.
- UI direction remains Persian/RTL, mobile-first, task/action oriented, with operational hierarchy rather than a generic analytics dashboard.
- Current remaining production gate: migrate operational data access from direct Supabase calls to Worker APIs, then run real multi-tenant E2E tests and deploy with configured Cloudflare secrets.
