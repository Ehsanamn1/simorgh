# Simorgh Obsidian Intelligence — reference-board mapping

## Product state and direct entry

The default route now opens the application workspace rather than a marketing landing page or login form. When there is no authenticated Supabase session, `WorkspaceGate` renders `PreviewWorkspace`: a navigable, read-only product preview. Public sign-in UI remains behind the build flag `VITE_ENABLE_AUTH_UI=true`, so account activation can be the final rollout step.

The preview never queries operational tables, never writes to Supabase and never creates fake production rows. All metric values are rendered as an em dash with an explanation. The actual authenticated application still renders `AppShell`, with role-filtered navigation and the existing server-side Supabase RLS policies.

## Reference elements → implementation

| Reference element | Application implementation | Data/permission contract |
| --- | --- | --- |
| Simorgh bird, wordmark and Obsidian Intelligence | Shared `src/SimorghLogo.tsx`, used by the operational shell and preview | SVG mark, brand label, Persian RTL and Vazirmatn typography |
| Obsidian, Surface, Elevated, Border, Text, Secondary, Accent and status swatches | Central tokens in `src/design-system.css`; swatches displayed in the preview masthead | Dark palette is default; `data-theme=light` overrides tokens; preference stored locally |
| Desktop sidebar and active navigation | `PreviewWorkspace` grouped navigation for guest preview; existing `navDefinitions` for signed-in users | Preview navigation is not an authorization grant; the real shell still derives routes from the authenticated membership role |
| Four KPI cards | Live dashboard in `App.tsx`; visually aligned KPI placeholders in the guest preview | Guest values remain blank; authenticated dashboard values/counts are queried from Supabase |
| Network map | Real OpenStreetMap embed in `PreviewWorkspace`; existing shipment GPS display in the authenticated shipment screen | Preview has no shipment markers. Actual markers require a real authorized GPS record |
| Production/sales trend | Existing Recharts-backed dashboard; empty chart frame in guest preview | No generated trend line; authenticated series must come from stored history |
| Recent orders | Existing dashboard query and Orders route; clean empty state in preview | No fabricated order, customer, price or delivery status |
| Capacity utilization | Existing capacity commitments page; empty dashboard panel in preview | No assumed capacity ratio; authenticated commitments determine the result |
| Finance and 50/50 partnership statement | Existing `partnership-agreements`, `partner-finance` and settlement routes; contract model preview | The 50/50 ring is explicitly labelled as the desired contract model, not a live balance or profit figure. Actual shares must come from a versioned agreement and ledger entries |
| Farm partner mobile home | Preview route backed by the daily-production/operational-task concept; authenticated routes remain intact | No task, production quantity, camera asset or approval is invented |
| Driver mobile app | Preview route and authenticated DriverWork/Shipments screens | Foreground GPS capture is separate and explicit; preview does not request device permissions or simulate live tracking |
| Customer mobile portal | Preview route and authenticated catalogue/order/account routes | No imaginary product, price, inventory, invoice or delivery ETA |
| Contextual AI recommendations | Preview route for the intelligence experience | No AI output is fabricated. Operational recommendations require a configured provider, grounded source records, permission checks, approval policy and execution logging |
| Mobile bottom navigation, safe areas and menu drawer | `PreviewWorkspace` plus existing authenticated `mobile-workspace-nav` | Responsive tests run against representative Playwright viewports |
| Motion and interaction feedback | Shared hover/focus transitions, small route transition, mobile drawer; reduced-motion override | Motion does not change business state |

## Verification

- The public entry must render the workspace on `/simorgh/` and `/simorgh/app/command` with no marketing portal or auth overlay.
- Dark/light theme toggling and persistence are checked by browser tests.
- Guest navigation, map help and desktop/mobile viewport overflow are checked by browser tests. CI screenshots capture the actual rendered preview.
- Authenticated workflows remain separately tested with browser-only sessions and mocked API responses; those tests do not write fixture rows to production.
- Real Supabase table reads/writes are intentionally not part of the guest preview. Production data is visible only after the owner provisions an account and the user obtains an active company membership.
