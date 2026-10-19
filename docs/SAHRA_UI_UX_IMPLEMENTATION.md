# Sahra UI/UX implementation matrix

Status legend:
- `[x]` = code changed in this branch (not a claim that the feature is fully validated).
- `[ ]` = still requires implementation and/or visual/functional verification.
- A page is not complete until its real data flow, loading/empty/error states, permissions, keyboard access, responsive layout, and regression checks pass.

## Approved identity
- [x] Product display name: صحرا / SAHRA.
- [x] Brand lockup: Persian name + SAHRA VALUE CHAIN LEADERS.
- [x] Geometric navy/cream/copper app mark and PWA icon.
- [x] Shared design tokens for navy `#1B2A3A`, copper `#8F6F52`, cream `#F3ECE6`, warm neutral `#EBE5DF`.
- [x] Initial light/dark semantic token mapping.
- [x] Document title, description, browser theme, boot screen, and installable manifest.
- [ ] Confirm the final vector mark against every supplied reference sheet at 16, 24, 32, 48, 64, and 192+ px; replace approximated paths if needed.
- [ ] Audit every user-visible legacy brand mention in all source files, tests, docs, PWA, native app display labels, and screenshots. Keep internal event names/API compatibility unchanged unless separately migrated.
- [ ] Run contrast checks for text, status badges, focus rings, and disabled states in both themes.

## Reference-sheet screen inventory

### Mobile identity and access (reference image: Mobile Application & UI System)
- [x] Brand identity component and installable app icon foundation.
- [x] Splash/boot screen brand label.
- [x] PWA title, theme color, and manifest branding.
- [ ] Welcome/login screen: layout, field labels, password visibility, validation, errors, loading, keyboard behavior, and return-to-login flows.
- [ ] Mobile safe-area checks, small-screen overflow, portrait/landscape behavior, and minimum 320 px width.
- [ ] Native Android/iOS app icon, splash assets, and displayed app name verification.

### Authenticated home/dashboard
- [x] Shared color system applied to shell and common dashboard surfaces.
- [x] Initial Sahra copy changes in core home and operational pages.
- [ ] Greeting/account identity and company/workspace selector.
- [ ] Active value-chain summary using real authorized data only.
- [ ] KPI cards with explicit date range, units, and loading/empty/error states.
- [ ] Value-chain creation/performance chart with accessible labels and real series.
- [ ] Quick actions, pending actions, recent activity, and drill-through routes.
- [ ] Mobile bottom navigation and desktop sidebar alignment with reference.

### Value-chain and logistics tracking
- [ ] Value-chain stage detail and status history.
- [ ] Supply → processing → distribution → value creation timeline.
- [ ] Milestones, owner/assignee, due dates, evidence, blockers, and audit history.
- [ ] Shipment/logistics map or route view only when valid location data is available; never fabricate GPS positions.
- [ ] Refresh, stale-data, offline, permission-denied, and no-results states.

### Inventory and warehouse
- [ ] Stock summary, locations, lots/batches, and movements.
- [ ] Filters/search/sort and server-side pagination for larger inventories.
- [ ] Receive, issue, transfer, adjust, and reconciliation flows with confirmation and audit records.
- [ ] Prevent invalid negative stock or unauthorized movement through server-side validation.
- [ ] Mobile table/card adaptation and accessible quantity/status indicators.

### Production and quality
- [ ] Production batch overview and completion workflow.
- [ ] Daily production and capacity details.
- [ ] Quality checks, evidence attachments, non-conformance, and corrective action states.
- [ ] Role-based action availability and auditability.

### Finance and digital invoices
- [ ] Transaction entry and validation.
- [ ] Partner/supplier settlements and reconciliation.
- [ ] Digital invoice details, status, export/print, and traceable references.
- [ ] Financial summaries with currency, date range, and reconciliation state.
- [ ] No fake successful payment/settlement states; all mutation feedback must reflect server responses.

### Reports and analytics
- [ ] Report catalogue, date filters, drill-down, and export formats actually supported by backend.
- [ ] Accessible charts, legends, units, empty datasets, and loading/error states.
- [ ] Export progress, failure handling, and permission checks.

### Account, members, permissions, notifications, collaboration
- [ ] User profile and account preferences.
- [ ] Member directory, role/permission matrix, invitation/provisioning, and deactivation confirmations.
- [ ] Notification center with unread/read and navigation to source records.
- [ ] Pending-action inbox with real action owners and resolution status.
- [ ] Chat/collaboration only if backed by a real service; otherwise clearly marked unavailable, not a simulated working control.
- [ ] Settings, theme preference, devices/sessions, and connection status.

### Shared component states
- [x] Initial brand token and common-control palette.
- [ ] Button default/hover/focus/pressed/disabled/loading.
- [ ] Input default/focus/invalid/disabled/success.
- [ ] Table loading/empty/error/pagination/sort/mobile overflow.
- [ ] Modal focus trap, Escape behavior, confirmation, and submit failure.
- [ ] Toast/alert live regions and non-color-only status signals.
- [ ] Reduced-motion behavior and visible keyboard focus.
- [ ] RTL/LTR mixed content: identifiers, usernames, dates, phone numbers, amounts, and English API/status tokens.

## Validation and release gates
- [ ] Typecheck and lint.
- [ ] Unit and API tests.
- [ ] Playwright authentication, dashboard, operational modules, help guide, responsive layout, and navigation.
- [ ] Mobile build workflow checks against the renamed copy and correct authenticated API origin.
- [ ] Visual snapshots at 320×720, 393×852, 768×1024, 1024×768, and 1440×900.
- [ ] Verify public portal, authenticated shell, role-specific workspaces, all operations pages, dialogs, and help overlay.
- [ ] Verify no horizontal overflow, clipped dialogs, invisible labels, unreadable status contrast, or dead buttons.
- [ ] Confirm Worker/Pages deployment and smoke-test the deployed URL before calling the release complete.

## Notes
The reference sheets are a visual and functional target, not proof that every pictured module already exists in the backend. This matrix intentionally distinguishes completed code edits from pending implementation and verification. Existing API routes, role enforcement, and internal event contracts must remain intact unless their own migration and tests are explicitly included.
