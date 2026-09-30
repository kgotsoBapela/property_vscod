# Architecture

## Components

```
Browser ──> Next.js (Vercel) ──RLS-scoped session──> Supabase Postgres <──service role── Worker (container)
               │  server components + route handlers       ▲                                  │
               │  never calls provider APIs                │ sync_jobs queue (SKIP LOCKED)     │ SourceAdapter → provider
               └── inserts manual jobs (Super Admin) ──────┘                                   │ (fixture only today)
```

- **apps/web**: Next.js 16 App Router. Pages read through a `DataRepository`:
  - `SupabaseRepository`: queries as the signed-in user, so RLS applies.
  - `DemoRepository`: used when Supabase env vars are absent. It is an in-memory store filled by running the synthetic fixture provider
    through the real sync pipeline at startup. Labelled "Demo" everywhere. Production refuses demo mode unless `ALLOW_DEMO_MODE=true`.
- **apps/worker**: polls `claim_next_sync_job()`, enqueues due schedules (cron in `Africa/Johannesburg`), heart-beats, and fails
  jobs whose worker disappeared (`fail_stale_jobs`). Talks to Postgres directly (`DATABASE_URL`).
- **packages/shared**: domain types, Zod schemas, permissions, analysis (comparables, acquisition costs, trends, market series),
  identity resolution, the adapter contract, the sync pipeline and its two stores (`MemorySyncStore`, `SqlSyncStore`).
  *Deviation from the suggested layout:* adapters, normalization and matching live in `packages/shared` so the demo mode, the
  worker and the tests share one implementation.

## Sync pipeline (`packages/shared/src/sync/pipeline.ts`)

fetch page (retry, bounded exponential backoff with jitter, Retry-After, timeout) → validate raw (adapter Zod schema) → normalize →
validate normalized (shared Zod schema) → content hash (skip unchanged) → identity resolution → `commit_sync_item` (one transaction per
record) → **checkpoint only after every record on the page is committed** → progress + events. Cancellation is honoured between pages;
paid-call quotas stop a job as `partially_completed`. A failure leaves prior data untouched.

## Identity resolution (`packages/shared/src/matching/identity.ts`)

Evidence, strongest first: provider ID → sectional scheme + unit → erf + portion + township → normalized street address → coordinates
within 30 m. A different unit, portion or township is **legally distinct** and is never merged. Conflicts cap confidence below the
auto-match threshold (0.95) and send the record to `identity_review_queue`. Auction lots that are not unambiguous keep a candidate list
and `property_id = null`.

## ERD (core)

```
auth.users 1─1 profiles
auth.users 1─1 user_roles(role)
integrations 1─* integration_capabilities
integrations 1─* sync_schedules
integrations 1─* sync_jobs 1─* sync_job_events
integrations 1─* sync_checkpoints(scope_key, cursor)

source_records(provider, external_id UNIQUE, content_hash, raw?, retention_until)
        │ provenance (source_record_id) on every normalized row
properties 1─* property_identifiers(kind: erf | sectional_scheme_unit | provider_property_id …)
properties 1─* property_sales(provider, external_id UNIQUE; sale_date ≠ registration_date; is_arms_length)
properties 1─* property_valuations(provider AVM: point, range, confidence, as_of)
properties 1─* comparable_sales(target, sale, analyst_override)   ← analyst decisions only; comps are computed
market_statistics(geography, segment, window, sample_count, medians)
identity_review_queue(provider, external_id, candidates, reason, status)

sheriff_offices 1─* auctions *─1 auction_houses
auctions 1─* auction_properties(lot → property_id? + candidate_property_ids[], confidence, evidence, review_status)
auctions 1─* auction_documents
auctions.prices jsonb: [{kind: auction_guide | auction_reserve | opening_bid | confirmed_hammer, amount?, published}]

users 1─* property_watchlists, analysis_scenarios, analysis_reports
audit_logs(actor, action, target, details)
```

## Security

- RLS on every table (`supabase/migrations/…_rls.sql`), mirrored by `packages/shared/src/permissions`. Route handlers check the same
  capability before acting; UI hiding is cosmetic.
- `source_records` (possibly licensed raw payloads) are readable by Super Admin only.
- `commit_sync_item`, `claim_next_sync_job`, `find_property_candidates`, `fail_stale_jobs` are executable by `service_role` only.
- Roles come from `app_metadata` (service-role only) at invitation; accounts without a role have no access.
- Super Admin requires TOTP MFA (AAL2) for every page and route.
- Logs pass through `redact()`; CSV exports neutralise formula injection; exports contain no owner/debtor personal data.
