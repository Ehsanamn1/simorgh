# Medar operating-system architecture

## Purpose

Medar is an operational system for running a real production and supply-chain business, not a collection of dashboard widgets. The product should connect people, assets, work, evidence, inventory, orders, deliveries, and finance to one auditable operational record.

This document describes the intended architecture and distinguishes the current foundation from future provider-dependent integrations.

## Architecture decisions

### 1. Modular monolith first

Keep the operational API as one Cloudflare Worker and organize code by business domain. Do not introduce microservices until deployment independence, traffic isolation, or a concrete scaling constraint justifies the extra operational cost.

Initial domains:

- Identity and tenancy: users, sessions, companies, memberships, invitations, and permissions.
- Contacts and counterparties: customers, suppliers, organization details, and relationship history.
- Operations: purchase orders, orders, inventory ledger, lots, production batches, quality, shipments, farm sites, and incidents.
- Work management: reusable task templates, assigned tasks, due dates, evidence, review, and escalation.
- Finance: invoices, settlements, partner ledger, imported bank transactions, reconciliation, and approvals.
- Documents: private evidence, contracts, receipts, and files tied to a specific company and business entity.
- Automation and AI: verified read tools, proposals, approval, execution, audit, usage limits, and provider adapters.

The React application shares one role-aware shell and reusable UI primitives. Routes and visible navigation are determined from the active membership, while the API remains the authority for access decisions.

### 2. PostgreSQL is the system of record

Critical business state lives in PostgreSQL. Model language output is never itself proof of a completed write. The Worker validates all input and authorization, applies business constraints in a transaction where needed, and returns the actual saved result.

Prefer relational foreign keys and company-scoped relationships for core entities. Use JSON for snapshots and provider payloads where appropriate, but not as a substitute for core relational invariants.

### 3. Tenant isolation and permissions

Every business read and write is bound to an active company membership on the server. User-supplied company IDs are only a request parameter, never proof of access. Role-based UI is a usability layer and does not replace server authorization.

The long-term permission model should support:
- company-level roles (owner, admin, staff, supplier, driver, customer),
- resource ownership and assignment constraints,
- separate permissions for read, create, update, approve, export, and delete,
- sensitive-operation confirmation,
- audited role and policy changes.

External counterparties must not see internal finance, private evidence, or other customers' records. Any new endpoint must have cross-company and cross-role tests.

### 4. Business events, tasks, and exception handling

Daily summaries should be generated from real records and clear business rules. High-value exceptions should become traceable records with:
- the condition detected and its source,
- severity, first-seen time, and current status,
- a responsible person and due date,
- suggested next actions,
- acknowledgement and resolution history.

Notifications are delivery channels for these records, not the source of truth. Deduplicate repeated warnings and make stale information obvious.

Use an idempotent execution key or state transition for retried operations. Any action that can affect multiple tables should use transactional SQL or a purpose-built PostgreSQL function so partial writes do not produce an inconsistent business state.

### 5. AI assistant and action execution

The assistant is a user interface over approved read tools and explicit action tools. It must not receive an unrestricted database connection.

Recommended maturity levels:

1. Ask questions and summarize authorized records with links or identifiers.
2. Analyze exceptions and explain which records support the conclusion.
3. Suggest a concrete, reviewable action.
4. Execute the approved low-risk action after user confirmation.
5. Run narrowly defined automations only after they have stable rules, ownership, observability, and rollback/recovery behavior.

Each proposal is inert until approved. Execution must re-check the actor's role and tenant membership, validate the target record, be idempotent under retries, and create an audit event. Financial transfers, final postings, destructive changes, and external messages require separate capability and confirmation design.

The first implemented action-tool vertical slice provides a proposal and approval record for creating an operational task. It is not yet general-purpose LLM function calling, and does not authorize arbitrary writes.

### 6. Provider adapters

AI, bank, maps, SMS/push, and file storage integrations must be adapters with explicit readiness and capability states. A provider is not "connected" just because a setting or API key exists; its health and actual capability need a successful test.

Never store bank login passwords, one-time codes, or provider API keys in browser storage. Secrets remain server-side. Return generic external errors to the client and keep secrets and full sensitive payloads out of logs.

### 7. Mobile and field operations

Driver workflows should center on the assigned shipment, destination, checklist, evidence capture, and completion state. A location record must include capture time and source so an old coordinate is never represented as live GPS.

Private photos and videos require authenticated upload/read/delete paths, tenant and entity ownership checks, content and size limits, and private object storage. Offline capture can be added with an explicit pending/sync/conflict state; it must not silently claim a server write has succeeded.

### 8. Finance and bank reconciliation

Start with read-only bank transaction imports and reconciliation suggestions. Maintain external transaction IDs, imported timestamps, account identity, currency, and source metadata to make imports idempotent. A suggested match remains a suggestion until reviewed or accepted under policy.

Do not enable payment initiation until the selected provider offers a valid production connection for the target bank, and authorization, limits, audit, duplicate prevention, and recovery tests are in place.

### 9. Observability and quality gates

Every business action should have a request/action identifier, a clear success or failure state, and enough audit metadata to diagnose the result without storing secrets. Health checks should differentiate API availability, database availability, and provider availability.

Required gates for new operational workflows:
- TypeScript, lint, unit tests, and production build.
- Fresh PostgreSQL migration chain and schema-readiness checks.
- role and cross-tenant authorization tests.
- Playwright flow tests for the actual UI and API contract.
- deployment smoke tests against a non-destructive health and authorization surface.
- explicit manual configuration checks for external providers.

## Current roadmap

### Phase A — operational coherence (this branch)
- persistent navigation back to the role home,
- more resilient assistant composer layout and UI-level send test,
- a role-gated agent action center,
- an inert proposal ledger and explicitly confirmed, audited task-creation tool,
- schema migration and CI/deployment checks for the action ledger,
- architecture documentation.

### Phase B — assistant quality and workflows
- connect approved read tools to the chat assistant with evidence and record references,
- make conversation/thread persistence deliberate rather than component-local,
- add proposal rendering to the conversation and keep confirmation visible,
- task templates, due-date policies, assignments, reminders, and exception deduplication,
- granular per-module and per-operation permissions.

### Phase C — realtime voice and field evidence
- evaluate a realtime speech provider for natural interruption and low latency,
- retain text transcripts and tool permissions identical to text chat,
- configure private R2 object storage and validate evidence upload/download,
- implement actual mission-based GPS with clear consent and last-updated timestamps.

### Phase D — finance integrations
- select a bank/provider for the specific account and jurisdiction,
- implement read-only import, duplicate-safe transaction ledger, and reconciliation review,
- reconcile invoices and settlements,
- consider payment initiation only after a separate security and reliability review.

## Explicit non-goals until prerequisites exist

- Do not emulate a live bank, GPS, file store, push notification, or speech-to-speech connection with fake data.
- Do not give the model arbitrary SQL, generic unrestricted CRUD, or secrets.
- Do not split into microservices without measurable need.
- Do not claim autonomous completion when only a suggestion was generated.
