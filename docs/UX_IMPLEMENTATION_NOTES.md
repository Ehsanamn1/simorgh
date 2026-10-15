# Simorgh UX implementation notes

Updated: 2026-10-15
Branch: \`feat/emerald-control-tower-ux\`
Base revision: \`c97166cde94f440dd600e75afff960b2c9fe381a\`

## Summary

This increment adds a centralized Emerald Control Tower stylesheet, a Supabase-backed sign-in entry for invited users, and role-aware mobile navigation. The existing \`App.tsx\`, \`OperationsPages.tsx\`, query code, role-filtered side navigation, and database schema remain in place.

## Design-system changes

- Adds CSS custom properties for the forest/emerald palette, typography baseline, borders, radius, shadows, touch-target height, and motion.
- Establishes consistent interaction styling for the current shell, forms, tables, status/empty states, and information surfaces.
- Adds a responsive secure-sign-in surface with accessible labels and errors, keyboard dismissal on the public landing page, and mobile safe-area padding.
- Preserves \`prefers-reduced-motion\` and strengthens visible focus treatment.
- Uses the existing Vazirmatn font configuration.

## Authentication and authorization

- The public landing page remains informational; it does not display email/password inputs or public registration.
- An “authorized members” entry opens email/password authentication using the existing Supabase client.
- Protected \`/app/*\` routes show the sign-in surface while no authenticated session exists.
- Sign-in does not assign a role. After Supabase authenticates the user, the existing AuthContext loads active memberships and the original role-filtered application determines access.
- New user provisioning, password recovery, SSO, and the first-owner bootstrap are not implemented in this increment.

## Mobile workspace navigation

The bottom navigation is built from the links that the authenticated AppShell already renders. It selects contextual primary destinations for manager, supplier, driver, and customer views but does not create additional routes or grant access. “More” opens the existing full side navigation.

## Verification and screenshots

Playwright coverage now includes 360×800, 390×844, 430×932, tablet portrait 768×1024, tablet landscape 1024×768, desktop 1365×900, and large desktop 1680×1050. E2E tests save screenshots for the public portal, manager Control Tower, and supplier task workspace into the standard Playwright test-results artifacts. The sign-in E2E test intercepts Supabase HTTP responses inside the browser; it does not create users or rows in the real database.

## Not claimed as complete

- No live AI recommendations or AI agent are added.
- No live GPS, background trip tracking, or live shipment map is added.
- Camera evidence, signatures, PWA/offline sync, and conflict resolution remain unverified/incomplete.
- The existing financial module still records internal commercial states; this UI change does not create bank transfers or replace backend financial calculations.
- No real-account role-isolation or negative-RLS penetration test is performed by browser fixtures.
- Screenshots are test artifacts from the CI run, not screenshots synthesized from a mockup.
