# South African Property Intelligence Dashboard

Internal decision-support tool: property search with legal-identity resolution, verified registered transfers, explainable
comparable-sale analysis, auction/sheriff intelligence, acquisition-cost scenarios and a Super Admin sync center.
Specification: [`CLAUDE.md`](CLAUDE.md). Architecture and ERD: [`docs/architecture.md`](docs/architecture.md).
Provider status: [`docs/provider-matrix.md`](docs/provider-matrix.md).

> **No real data source is connected.** Every candidate provider is unverified. The app runs on a clearly labelled
> **synthetic fixture provider** until a licensed agreement exists. Not a certified appraisal, legal opinion or guarantee of auction status.

## Status

| Phase | State |
|---|---|
| 0 Discovery | Provider matrix and outreach checklist written; **no provider verified** (blocking Phase 2) |
| 1 Foundation | Done: monorepo, Next.js UI, migrations, auth/RLS/roles, design system, CI |
| 2–4 | Built end-to-end against the synthetic provider (identity resolution, history, comps, valuation, auctions, sheriffs) |
| 5 Background ops | Worker, queue, schedules, retries, checkpoints, cancellation, stale-job handling done; alert delivery (email/Slack) not yet |
| 6 Hardening | Not started |

## Quick start (demo mode, no setup)

```bash
npm install
npm run dev          # http://localhost:3000
```

With no Supabase env vars the app starts in **demo mode**: synthetic data, no login, and a "View as" role switcher to exercise
Super Admin / Admin / Viewer permissions. Data resets on restart.

Try: search `erf 107`, `12 Sample Avenue` (12 sectional units share this address) or `erf 512` (two portions of one erf). Open a
property, then Comparables, Report and Scenario. In the Sync center, queue an incremental sync with failure injection and watch the job log.

## Running against Supabase

1. Create a Supabase project and apply `supabase/migrations/*` in order, then `supabase/seed.sql`
   (`supabase db push` with the Supabase CLI, or the SQL editor).
2. Copy `.env.example` → `apps/web/.env.local` (web) and set the worker env vars.
3. Bootstrap the first Super Admin: create the user in Supabase Auth, then
   `insert into user_roles (user_id, role) values ('<uuid>', 'super_admin');`. Further users are invited from *Team & roles*.
4. Configure Supabase Auth (dashboard):
   - **URL Configuration:** Site URL = the app's origin (e.g. `http://localhost:3000`).
   - **Sign In / Providers:** disable "Allow new users to sign up" (invitation-only); keep Email enabled; TOTP MFA enabled.
   - **Email templates:** email links must point at `/auth/confirm`, which asks the person to click *Continue* before the one-time
     token is used (so corporate link scanners cannot consume it):
     - *Invite user*: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a>`
     - *Reset password*: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">Reset your password</a>`
   - **SMTP:** the built-in sender is heavily rate-limited; configure your own SMTP before real use.
5. Run the worker: `DATABASE_URL=… npm run worker` (or `docker build -f apps/worker/Dockerfile .`).
6. In the Sync center, run an **Auction refresh** and a **Provider incremental sync** on the fixture integration to load demo data.

## Commands

| | |
|---|---|
| `npm run dev` | web app |
| `npm run worker` | background worker (needs `DATABASE_URL`) |
| `npm test` | all tests: analysis, identity matching, pipeline, **migrations + RLS on real PostgreSQL (PGlite)**, scheduler |
| `npm run typecheck` / `npm run lint` / `npm run build` | CI checks |

## Layout

```
apps/web/            Next.js app: (auth), (dashboard), api/; components/{ui,dashboard,charts,property,auction,sync}; lib/{data,auth,supabase}
apps/worker/         job loop, scheduler, adapter registry, Dockerfile
packages/shared/     types, schemas, permissions, analysis, matching, adapters (fixture), sync pipeline + stores, tests
supabase/            migrations (schema, functions, RLS) and seed (integrations only)
docs/                architecture/ERD, provider matrix
```

## Decisions still blocking production

- First geographic market and **first licensed provider** (documentation, sample payloads, pricing, display/retention rights).
- Auction and sheriff source strategy and whether automated refresh is permitted.
- Map/geocoding provider and display rights (comps currently use a distance-vs-price plot, not a map).
- Alert delivery channel for failed/stale syncs (UI alerts exist; no email/Slack yet).
- Retention, backup/restore and disaster-recovery requirements; POPIA review of any personal data a provider returns.
- Transfer-duty table (`packages/shared/src/analysis/acquisition.ts`) must be confirmed against SARS each Budget.
