# Simorgh deployment status

Status checked: 2026-10-15.

## Source status

- Independent React + TypeScript + Vite source is present in this repository.
- Supabase client setup and a seed-free Postgres migration are included.
- The migration defines 18 application tables and enables RLS on all 18.
- Cloudflare Pages SPA fallback, a Pages-compatible output configuration, a GitHub Actions verification workflow, and setup documentation are included.
- Static syntax checks for TypeScript/TSX, CSS, HTML, and JSON passed in the authoring environment.

## Not yet verified or connected

- `npm install` could not finish in the authoring environment because the npm registry was unreachable; therefore TypeScript typecheck, ESLint, Vitest and Vite production build have **not** been verified here.
- No `package-lock.json` is bundled because dependency resolution could not complete. Run `npm install` in a network-enabled environment, review and commit the generated lockfile, then run all four verification commands before production release.
- The Supabase migration has not been applied to any database. No Supabase project URL or publishable key has been configured. The live RLS rules and business flows still require testing against a fresh dedicated project.
- No dedicated `Ehsanamn1/simorgh` GitHub repository has been created by this environment, because the connected GitHub tools do not expose repository creation.
- No Cloudflare Pages project has been created or deployed. This environment has no authenticated Cloudflare API credentials or deployment tool.

## Required release sequence

1. Create an empty dedicated GitHub repository named `simorgh` under the intended account; do not use `cortex-ai`.
2. Push this source to its `main` branch and let the GitHub Actions workflow complete successfully.
3. In a dedicated Supabase project, review and apply `supabase/migrations/20261015000000_simorgh_core.sql`, create the first owner membership, configure Auth URLs, and test RLS with owner, staff, buyer, supplier and driver accounts.
4. In Cloudflare Pages, connect that GitHub repository with build command `npm run build` and output directory `dist`. Set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as build-time variables.
5. Verify sign-in, permission boundaries, order price enforcement, capacity allocation, shipment transitions, storage uploads, and rollback/recovery before using it for real business operations.

Never put a Supabase service-role/secret key in a `VITE_` variable or commit secrets to Git.
