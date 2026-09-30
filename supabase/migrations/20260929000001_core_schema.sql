-- Core schema for the South African Property Intelligence Dashboard.
-- Normalized entities are kept separate from source_records (provenance). Every provider-sourced row
-- is unique on (provider, external_id) so repeated syncs upsert idempotently.

-- gen_random_uuid() is built into PostgreSQL 13+; no extension required.

-- ---------------------------------------------------------------------------
-- Users, roles, audit
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('super_admin', 'admin', 'viewer')),
  granted_by uuid references auth.users (id),
  granted_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid references auth.users (id),
  actor_label text not null,
  action text not null,
  target text,
  details jsonb
);
create index audit_logs_at_idx on public.audit_logs (at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, at desc);

-- ---------------------------------------------------------------------------
-- Integrations and synchronization
-- ---------------------------------------------------------------------------
create table public.integrations (
  id uuid primary key default gen_random_uuid(),
  provider_key text not null unique,
  display_name text not null,
  category text not null check (category in ('property_data', 'auctions', 'sheriff_notices', 'gazette', 'fixture')),
  status text not null default 'candidate'
    check (status in ('candidate', 'in_discussion', 'sandbox', 'active', 'suspended', 'rejected')),
  website text,
  is_demo boolean not null default false,
  notes text,
  -- Provider matrix fields (docs/provider-matrix.md). Unknown stays null, never guessed.
  auth_method text,
  historical_coverage text,
  geographic_coverage text,
  update_frequency text,
  quota_per_day integer,
  cost_per_call_zar numeric(12, 2),
  monthly_cost_zar numeric(12, 2),
  display_rights text,
  retention_rights text,
  automated_refresh_permitted boolean,
  contact_owner text,
  max_paid_calls_per_job integer,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.integration_capabilities (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  capability text not null
    check (capability in ('subject_property', 'nearby_sales', 'auctions', 'provider_incremental', 'full_reconciliation')),
  primary key (integration_id, capability)
);

create table public.sync_schedules (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id) on delete cascade,
  scope text not null check (scope in ('auctions', 'provider_incremental', 'full_reconciliation')),
  cron text not null default '0 2 * * *',
  timezone text not null default 'Africa/Johannesburg',
  enabled boolean not null default false,
  next_run_at timestamptz,
  last_enqueued_at timestamptz,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (integration_id, scope)
);

create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations (id),
  scope text not null
    check (scope in ('subject_property', 'nearby_sales', 'auctions', 'provider_incremental', 'full_reconciliation')),
  target_property_id uuid,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partially_completed', 'failed', 'cancellation_requested', 'cancelled')),
  trigger text not null check (trigger in ('schedule', 'manual')),
  requested_by uuid references auth.users (id),
  approved_high_cost_by uuid references auth.users (id),
  worker_id text,
  heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  records_fetched integer not null default 0,
  records_upserted integer not null default 0,
  records_failed integer not null default 0,
  estimated_cost_zar numeric(12, 2),
  error_category text,
  error_message text
);
create index sync_jobs_status_idx on public.sync_jobs (status, created_at);
create index sync_jobs_integration_idx on public.sync_jobs (integration_id, created_at desc);
-- Overlap protection: one active job per provider + scope + target.
create unique index sync_jobs_no_overlap_idx on public.sync_jobs (
  integration_id, scope, coalesce(target_property_id, '00000000-0000-0000-0000-000000000000'::uuid)
) where status in ('queued', 'running', 'cancellation_requested');

create table public.sync_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.sync_jobs (id) on delete cascade,
  at timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'error')),
  message text not null,
  data jsonb
);
create index sync_job_events_job_idx on public.sync_job_events (job_id, id);

create table public.sync_checkpoints (
  integration_id uuid not null references public.integrations (id) on delete cascade,
  scope_key text not null,
  cursor text,
  updated_at timestamptz not null default now(),
  primary key (integration_id, scope_key)
);

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------
create table public.source_records (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  content_hash text not null,
  raw jsonb, -- only when the licence permits storing the payload
  document_path text, -- Supabase Storage path for permitted documents
  first_retrieved_at timestamptz not null default now(),
  retrieved_at timestamptz not null default now(),
  retention_until timestamptz,
  is_demo boolean not null default false,
  last_job_id uuid references public.sync_jobs (id) on delete set null,
  unique (provider, external_id)
);

-- ---------------------------------------------------------------------------
-- Properties and legal identity
-- ---------------------------------------------------------------------------
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  normalized_address text not null,
  street_number text,
  street_name text,
  unit_number text,
  complex_name text,
  suburb text not null,
  municipality text,
  province text not null,
  postal_code text,
  latitude double precision check (latitude between -35.5 and -21.5),
  longitude double precision check (longitude between 16 and 33.5),
  property_type text not null check (property_type in ('freehold', 'sectional_title', 'agricultural', 'vacant_land', 'commercial')),
  erf_size_m2 numeric(12, 2),
  floor_size_m2 numeric(12, 2),
  bedrooms smallint,
  bathrooms numeric(4, 1),
  is_demo boolean not null default false,
  -- Normalized "number street, suburb" (see streetAddressKey in packages/shared); supporting evidence only.
  street_key text,
  search_text text generated always as (
    lower(coalesce(normalized_address, '') || ' ' || coalesce(complex_name, '') || ' ' || suburb || ' ' || coalesce(municipality, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_suburb_idx on public.properties (suburb, property_type);
create index properties_geo_idx on public.properties (latitude, longitude);
create index properties_street_key_idx on public.properties (street_key);
create index properties_search_idx on public.properties using gin (to_tsvector('simple', search_text));

create table public.property_identifiers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  kind text not null check (kind in ('erf', 'farm_portion', 'sectional_scheme_unit', 'title_deed', 'provider_property_id')),
  erf_number text,
  portion text,
  township text,
  scheme_name text,
  scheme_number text,
  unit_number text,
  title_deed text,
  provider text not null,
  external_id text,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified', 'unverified', 'disputed', 'superseded')),
  match_confidence numeric(4, 3),
  match_evidence text[],
  source_record_id uuid references public.source_records (id) on delete set null,
  retrieved_at timestamptz not null default now(),
  is_demo boolean not null default false
);
create unique index property_identifiers_provider_id_uq on public.property_identifiers (provider, external_id)
  where kind = 'provider_property_id';
create unique index property_identifiers_erf_uq on public.property_identifiers (
  provider, lower(township), erf_number, coalesce(portion, '')
) where kind = 'erf';
create unique index property_identifiers_sectional_uq on public.property_identifiers (
  provider, lower(coalesce(scheme_number, scheme_name)), unit_number
) where kind = 'sectional_scheme_unit';
create index property_identifiers_property_idx on public.property_identifiers (property_id);
create index property_identifiers_erf_idx on public.property_identifiers (erf_number);
create index property_identifiers_scheme_idx on public.property_identifiers (lower(scheme_number), lower(scheme_name));

create table public.identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  description text not null,
  candidates jsonb not null,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution text check (resolution in ('merged', 'created_new', 'rejected')),
  resolved_property_id uuid references public.properties (id),
  source_record_id uuid references public.source_records (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz
);
create unique index identity_review_open_uq on public.identity_review_queue (provider, external_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Transactions, valuations, comparables, market statistics
-- ---------------------------------------------------------------------------
create table public.property_sales (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  provider text not null,
  external_id text not null,
  transfer_amount numeric(14, 2) check (transfer_amount >= 0),
  sale_date date,
  registration_date date,
  transfer_type text not null
    check (transfer_type in ('market_sale', 'sale_in_execution', 'deceased_estate', 'donation', 'related_party', 'divorce', 'other')),
  is_arms_length boolean not null,
  title_deed text,
  verification_status text not null check (verification_status in ('verified', 'unverified', 'disputed', 'superseded')),
  source_record_id uuid references public.source_records (id) on delete set null,
  retrieved_at timestamptz not null,
  is_demo boolean not null default false,
  unique (provider, external_id),
  check (sale_date is null or registration_date is null or sale_date <= registration_date)
);
create index property_sales_property_idx on public.property_sales (property_id, registration_date desc);
create index property_sales_date_idx on public.property_sales (registration_date desc) where is_arms_length and verification_status = 'verified';

create table public.property_valuations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties (id) on delete cascade,
  provider text not null,
  external_id text not null,
  model text not null,
  methodology_version text not null,
  point_estimate numeric(14, 2),
  range_low numeric(14, 2),
  range_high numeric(14, 2),
  as_of_date date not null,
  confidence text not null check (confidence in ('high', 'medium', 'low', 'insufficient_data')),
  confidence_notes text,
  supporting_sale_ids uuid[],
  source_record_id uuid references public.source_records (id) on delete set null,
  retrieved_at timestamptz not null,
  is_demo boolean not null default false,
  unique (provider, external_id),
  check (range_low is null or range_high is null or range_low <= range_high)
);
create index property_valuations_property_idx on public.property_valuations (property_id, as_of_date desc);

-- Analyst decisions about comparables for a target property (inclusion overrides and notes).
create table public.comparable_sales (
  id uuid primary key default gen_random_uuid(),
  target_property_id uuid not null references public.properties (id) on delete cascade,
  sale_id uuid not null references public.property_sales (id) on delete cascade,
  analyst_override text check (analyst_override in ('include', 'exclude')),
  adjustment_notes text,
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  unique (target_property_id, sale_id)
);

create table public.market_statistics (
  id uuid primary key default gen_random_uuid(),
  geography_kind text not null check (geography_kind in ('suburb', 'municipality', 'province')),
  geography_name text not null,
  property_type text not null,
  period_start date not null,
  period_end date not null,
  sample_count integer not null,
  median_price numeric(14, 2),
  mean_price numeric(14, 2),
  median_price_per_m2 numeric(12, 2),
  provider text not null, -- 'derived' when computed from our own registered sales
  retrieved_at timestamptz not null default now(),
  is_demo boolean not null default false,
  unique (provider, geography_kind, geography_name, property_type, period_start, period_end)
);

-- ---------------------------------------------------------------------------
-- Auctions and sheriffs
-- ---------------------------------------------------------------------------
create table public.auction_houses (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  name text not null,
  website text,
  is_demo boolean not null default false,
  unique (provider, external_id)
);

create table public.sheriff_offices (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  name text not null,
  jurisdiction text not null,
  province text not null,
  physical_address text,
  phone text,
  email text,
  contact_verified_at timestamptz,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified', 'unverified', 'disputed', 'superseded')),
  source_url text,
  source_record_id uuid references public.source_records (id) on delete set null,
  retrieved_at timestamptz not null,
  is_demo boolean not null default false,
  unique (provider, external_id)
);

create table public.auctions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_id text not null,
  kind text not null check (kind in ('sheriff_sale', 'private_auction', 'online_auction')),
  auction_house_id uuid references public.auction_houses (id),
  sheriff_office_id uuid references public.sheriff_offices (id),
  title text not null,
  event_at timestamptz,
  venue text,
  status text not null check (status in ('scheduled', 'postponed', 'cancelled', 'sold', 'no_sale', 'withdrawn', 'unknown')),
  status_history jsonb not null default '[]'::jsonb,
  -- [{kind: auction_guide|auction_reserve|opening_bid|confirmed_hammer, amount, published}] — never merged into one "price"
  prices jsonb not null default '[]'::jsonb,
  deposit_terms text,
  conditions_summary text,
  case_reference text,
  notice_url text,
  last_verified_at timestamptz,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified', 'unverified', 'disputed', 'superseded')),
  source_record_id uuid references public.source_records (id) on delete set null,
  retrieved_at timestamptz not null,
  is_demo boolean not null default false,
  unique (provider, external_id)
);
create index auctions_event_idx on public.auctions (event_at);
create index auctions_status_idx on public.auctions (status, event_at);

create table public.auction_properties (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  lot_index integer not null,
  property_id uuid references public.properties (id) on delete set null, -- only on unambiguous match
  candidate_property_ids uuid[] not null default '{}',
  lot_number text,
  described_address text not null,
  described_erf text,
  match_confidence numeric(4, 3) not null default 0,
  match_evidence text[] not null default '{}',
  review_status text not null check (review_status in ('auto_matched', 'needs_review', 'confirmed', 'rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  unique (auction_id, lot_index)
);
create index auction_properties_property_idx on public.auction_properties (property_id);
create index auction_properties_candidates_idx on public.auction_properties using gin (candidate_property_ids);

create table public.auction_documents (
  id uuid primary key default gen_random_uuid(),
  auction_id uuid not null references public.auctions (id) on delete cascade,
  provider text not null,
  external_id text not null,
  kind text not null check (kind in ('notice', 'conditions_of_sale', 'gazette', 'other')),
  title text not null,
  url text,
  storage_path text,
  published_at timestamptz,
  retrieved_at timestamptz not null,
  is_demo boolean not null default false,
  unique (provider, external_id)
);

-- ---------------------------------------------------------------------------
-- User workspace
-- ---------------------------------------------------------------------------
create table public.property_watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid not null references public.properties (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, property_id)
);

create table public.analysis_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  name text not null,
  inputs jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);

create table public.analysis_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  property_id uuid references public.properties (id) on delete set null,
  snapshot jsonb not null, -- inputs, outputs, citations and source dates at generation time
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Read views
-- ---------------------------------------------------------------------------
create view public.v_data_freshness with (security_invoker = true) as
select
  i.id as integration_id,
  i.display_name,
  i.is_demo,
  i.last_success_at,
  i.last_failure_at,
  (select max(s.retrieved_at) from public.source_records s where s.provider = i.provider_key) as latest_record_at,
  coalesce(i.last_success_at < now() - interval '36 hours', true) as is_stale
from public.integrations i
where i.status in ('active', 'sandbox');

-- Same legal identifier asserted for two different canonical properties → needs human review.
create view public.v_identifier_conflicts with (security_invoker = true) as
select a.property_id as property_a, b.property_id as property_b, a.kind, a.erf_number, a.portion, a.township,
       a.scheme_number, a.unit_number
from public.property_identifiers a
join public.property_identifiers b
  on a.kind = b.kind and a.property_id < b.property_id
 and (
   (a.kind = 'erf' and a.erf_number = b.erf_number and lower(a.township) = lower(b.township)
     and coalesce(a.portion, '') = coalesce(b.portion, ''))
   or (a.kind = 'sectional_scheme_unit' and lower(coalesce(a.scheme_number, a.scheme_name)) = lower(coalesce(b.scheme_number, b.scheme_name))
     and a.unit_number = b.unit_number)
 );
