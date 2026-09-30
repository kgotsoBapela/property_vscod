# CLAUDE.md — South African Property Intelligence Dashboard

## Role and operating instructions
You are the engineering assistant for a South African real-estate analytics and property valuation web application. Treat this document as the product and technical specification. Before coding, review the repository, identify what exists, propose a phased implementation plan, and ask for approval. Do not claim that an API or data feed is available until documentation, credentials, pricing, and licensing have been verified. Never invent property transactions, auction dates, sheriff details, or valuation certainty.

## Product objective
Build an internal dashboard that lets a small team search for a South African property by street address, suburb, erf number, or sectional-title identifier and view:
1. Up to five most recent **verified registered sales of the subject property**, with prices, transaction/registration dates, source, and available legal identifiers. If fewer than five exist, say so.
2. Recent nearby **registered comparable sales**, including licensed addresses, sale prices, dates, distance, property type and available attributes; configurable radius, lookback period and filters.
3. Valuation estimates, valuation ranges, comparable-sale adjustments, historical appreciation, suburb trends and clearly explained data quality/confidence.
4. Auction listings potentially matching the property, including auctioneer, published guide/reserve price (distinguished), event date/time, location, status, original notice and conditions of sale.
5. Sheriff sale information, including sheriff office/jurisdiction, verified contact details, case/reference where lawfully available, deposit, conditions, postponements/cancellations and source documents.
6. Investment/acquisition scenarios: bid/offer price, estimated fees, transfer costs, known arrears, renovation allowance, total acquisition cost and valuation-based sensitivity analysis. Never imply unknown costs are zero.

Initially target South Africa; keep country-specific source adapters and legal identifiers extensible. This is decision-support software, not a certified appraisal, legal opinion or guarantee of auction status.

## Confirmed decisions
- Framework: Next.js App Router + TypeScript.
- UI: Tailwind CSS, shadcn/ui; TanStack Table for tables, Recharts for charts, TanStack Query for interactive client data.
- Backend: Supabase PostgreSQL, Auth, Storage and Row Level Security.
- Hosting: Next.js on Vercel; a separate managed containerized Node.js/TypeScript synchronization worker; Supabase for database and scheduling/queue facilities if supported by the selected plan.
- Audience: small internal team. Roles: Super Admin, Admin, Viewer.
- Initial data volume: fewer than 10,000 records; design for growth without premature microservices.
- Number of external APIs: undecided; build provider-agnostic adapters.
- Default ingestion: daily scheduled synchronization; Super Admin can manually trigger live fetch for a selected property, nearby comps, auctions or an entire integration. More frequent auction checks may be configured for imminent events.
- Development status: planning; user approval required before implementing the application.

## Architecture
Use a modular monolith for the Next.js app and a separate background worker. The browser reads normalized data from Supabase through authorized Next.js server components and route handlers; it must not contact paid provider APIs or receive provider secrets. Both scheduled and manual sync create jobs in one durable job system. The worker claims jobs atomically, fetches via an adapter, validates with Zod, stores source provenance, resolves identities, upserts records, updates checkpoints only after successful commits, and writes operational events. Return a job ID promptly to the manual-sync UI; show progress independently.

Suggested repo layout:
```
apps/web/src/app/{(auth),(dashboard),api}/
apps/web/src/components/{ui,dashboard,charts,tables,property,auction,sync}/
apps/web/src/lib/{supabase,auth,reporting}/
apps/worker/src/{jobs,adapters,normalization,matching}/
packages/shared/src/{types,schemas,permissions}/
supabase/migrations/
```
A simpler equivalent layout is acceptable if documented. Prefer SQL migrations and explicit typed queries. Use server-side pagination/filtering. Start with indexed ordinary PostgreSQL views; use materialized views only when measured query performance warrants them.

## Candidate external data providers — verify before integrating
### Property transactions, deeds and valuations
- **Lightstone**: https://portal.apis.lightstone.co.za/ and https://www.lightstoneproperty.co.za/PropertyToolkit.aspx — investigate licensed property/deeds, transfer history, comparable sales, AVM and suburb data APIs. Request actual endpoint docs, sample responses, coverage, costs, retention and display rights.
- **Property24 Property Data**: https://www.property24.com/products/property-data — property reports and transaction/comparable data; programmatic access and reuse rights are **unconfirmed**. Seek authorized commercial access; do not scrape in violation of terms.
- **Lexis WinDeed**: https://www.windeed.co.za/ — deeds, transfers, address/erf matching and valuation products; programmatic access and retention rights **unconfirmed**.
- **South African deeds registry / authorized resellers**: evaluate official access channels and licensed providers for authoritative legal identifiers and transfer verification.
### Auctions and sheriff notices
- **Aucor Property**: https://www.aucorproperty.co.za/ — auction listings and documents; API/feed **unconfirmed**.
- **GemFinder**: https://www.gemfinder.co.za/ — investigate sheriff auction aggregation and licensing; API/feed **unconfirmed**.
- **RepoLens**: https://repolens.co.za/sheriff-auctions — investigate sheriff/Gazette-derived data and licensing; API/feed **unconfirmed**.
- **Government Printing Works**: https://www.gpw.gov.za/Government-Gazettes/ — official notices; may require licensed/permitted document ingestion and manual verification.
- Individual sheriff offices and auctioneers: verified official notices, conditions of sale, office/jurisdiction/contact data; prefer agreements or permitted feeds.

Maintain a provider matrix for every candidate: endpoint/feed, authentication, fields, historical coverage, geographic coverage, update frequency, API quota, per-call and monthly costs, commercial display/retention/export rights, permitted automated refresh, document provenance, status and contact owner. Do not hardcode unverified prices or promise complete five-sale histories, bid histories or final hammer prices.

## Core data model (refine after reviewing real API schemas)
- `profiles`, `user_roles`, `audit_logs`.
- `integrations`, `integration_capabilities`, `sync_schedules`, `sync_jobs`, `sync_job_events`, `sync_checkpoints`.
- `properties`: canonical ID, normalized address, suburb, municipality, province, geo coordinates where licensed, property type, physical attributes.
- `property_identifiers`: provider-specific IDs, erf/portion, township, sectional scheme and unit identifiers; provenance and verification status.
- `source_records`: provider, external ID, retrieval timestamp, permitted raw JSON/document reference, content hash, licensing/retention metadata.
- `property_sales`: subject property, transfer amount, sale date vs registration date, transfer type, source record, verification status; preserve provenance and avoid treating non-arm's-length transfers as ordinary market comparables.
- `property_valuations`: provider/model, point estimate, range, as-of date, methodology version, confidence/data sufficiency and supporting comps.
- `comparable_sales`: target property, sale, distance, similarity attributes, inclusion/exclusion, adjustment notes.
- `market_statistics`: geography, property segment, observation window, sample count, median and trend metrics.
- `auction_houses`, `auctions`, `auction_properties`, `auction_documents`, `sheriff_offices`.
- `property_watchlists`, optional `analysis_reports` and `analysis_scenarios`.

Create uniqueness constraints for `(provider, external_id)` and appropriate property identifiers; use foreign keys and indexes on property, area, event date and sync status. Keep source records separate from normalized entities. Protect privileged tables with RLS/service-only access. Store provider secrets in an appropriate secrets manager, not publicly readable database columns.

## Property identity resolution
Normalize addresses but do not rely on address alone. Prioritize authoritative erf/portion, township and sectional scheme/unit identifiers. Use provider IDs and geolocation as supporting evidence. Store match confidence and evidence. Send ambiguous matches to a human review queue; never silently merge two units or properties at the same street address. Maintain a traceable mapping between each provider record and the canonical property.

## Sync behavior and operational requirements
- Default schedule: daily, provisionally 02:00 Africa/Johannesburg; independently configurable per integration.
- Manual modes: subject-property refresh, nearby sales refresh, auction refresh, provider incremental sync and full reconciliation if supported.
- Queue manual jobs promptly; protect against overlapping jobs for the same provider/scope, enforce quotas and show estimated paid-call cost when possible.
- Use pagination, incremental cursors/update timestamps where supported, rate-limit handling, bounded exponential backoff, timeouts, idempotent upserts and resumable checkpoints.
- Statuses: queued, running, completed, partially completed, failed, cancellation requested/cancelled. Keep job counts, durations, error categories and redacted logs.
- Never advance a checkpoint before durable writes. Preserve the last good dataset on failure; show data freshness and source timestamps.
- Treat absence from an API page as **not** proof of deletion. Reconcile deletions only under verified provider semantics.
- Recheck near-term auctions more frequently if the provider's terms permit. Prominently mark unverified, postponed and cancelled events; link to original notices and advise confirmation with the sheriff/auctioneer.
- Alert Super Admin on failed syncs and stale datasets (initial proposed threshold: 36 hours). Confirm retention, backup and disaster recovery requirements before production.

## UX and screens
1. Sign-in, invitation flow, password recovery and MFA for Super Admin.
2. Overview: searched properties, tracked assets, market summary, sync freshness and alerts.
3. Property search and identity-resolution picker.
4. Property detail: identifiers and attributes, last five available verified registered transfers, chronological history, charts, valuation range, recent comps map/table, market statistics and provenance.
5. Comparable-sale explorer: radius/lookback/property filters, sortable table, map, inclusion/exclusion and adjustment explanations.
6. Auction intelligence: property match confidence, auctioneer, guide/reserve/opening bid separately, dates, status, original documents and verification time.
7. Sheriff directory/details: jurisdiction, verified contacts, notices, conditions, case reference where available and source links.
8. Investment scenario calculator and downloadable analysis report with citations/source dates and explicit unknowns.
9. Super Admin sync center: source health, job history, progress, manual triggers, schedule management, quotas and costs.
10. Integration administration, team/roles, audit logs and settings.

For every price, label its meaning: registered transfer, asking price, AVM estimate, auction guide, reserve, opening bid or confirmed hammer price. Never substitute one for another. Show source, effective date and freshness on each major data panel. Make missing data an explicit state rather than fabricating it.

## Permissions
- Super Admin: all authorized data, integrations, credentials management, schedule changes, manual sync, users, full audit logs.
- Admin: permitted property analysis, reports, exports and limited user management; no API secrets or sync trigger by default.
- Viewer: permitted read-only analysis and exports.
Enforce authorization in server routes and database RLS; UI hiding is not a security boundary. Invitation-only onboarding initially. Require explicit approval for high-cost full refreshes.

## Security and compliance
Handle address and personal data in accordance with applicable South African privacy law and provider contracts. Minimize unnecessary owner/debtor personal information. Redact credentials and sensitive fields in logs and exports. Enforce TLS, secure sessions, least-privilege service roles, MFA for Super Admin, audited privileged actions, encrypted secrets, database backups and tested restore. Obtain permission for document storage, automated collection, geocoding and data redistribution. Do not bypass captchas, paywalls or access restrictions.

## Testing and acceptance criteria
Automated tests for auth/RLS, adapter contracts, validation, property matching (especially sectional title), pagination, retries, idempotency, duplicate prevention, stale-data warnings, job cancellation, export authorization and auction status changes. Use fixture/synthetic data until a provider agreement exists; label demo data. The first end-to-end milestone is: search an address → resolve a legal property → fetch licensed history → show up to five registered transfers → retrieve nearby registered comps → calculate explainable analysis → save to Supabase → show source timestamps → trigger a Super Admin refresh and inspect the job log. Verify that a failed refresh preserves the prior valid results.

## Development phases and approval gates
**Phase 0 — Discovery (no paid API calls):** Confirm first geographic market, actual provider agreements and sample payloads, reporting fields, legal permissions, operating budget, auction coverage and sheriff-source strategy. Produce a provider matrix and a revised schema. Ask for approval.
**Phase 1 — Foundation:** Initialize monorepo/Next.js UI, Supabase environments, migrations, auth/RLS, roles, design system and CI. Ask for approval before substantial expansion.
**Phase 2 — First property-data adapter:** Integrate one verified/licensed source, implement address/erf resolution, history and comps, provenance and tests.
**Phase 3 — Valuation and analysis:** Implement provider AVM if licensed, explainable comparable analysis, local market stats and report generation.
**Phase 4 — Auction and sheriff:** Integrate one authorized source, build auction matching, event-status verification, sheriff details and document linking.
**Phase 5 — Background operations:** Daily schedule, worker, retries, checkpoints, manual refresh, monitoring, costs and alerting. Build minimal job infrastructure earlier as needed for Phases 2–4.
**Phase 6 — Hardening and release:** Security review, integration tests, staging, backup/restore, deployment, user acceptance and documentation.

## Instructions for your first response in a new Claude session
1. Read this document and inspect the existing repository, if any.
2. Summarize the scope, explicitly identify unconfirmed API access and licensing, and list decisions blocking implementation.
3. Propose a concrete MVP with milestones, the first provider outreach checklist, a database ERD and initial screen wireframe descriptions.
4. Ask the user to approve the MVP/provider strategy **before generating the app or making paid API calls**.
5. Once approved, implement one phase at a time with clear file changes, migration/test commands and acceptance checks. Never present mock property data as real.
