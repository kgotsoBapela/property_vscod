-- Seed: integrations only. Property, sale and auction rows are NOT seeded here; run the worker against the
-- synthetic fixture integration to populate labelled demo data through the real sync pipeline.
--
-- Candidate providers are listed with status 'candidate' and every commercial field NULL (unknown).
-- Nothing here asserts that an API exists, what it costs or what it may be used for.

insert into public.integrations (provider_key, display_name, category, status, website, is_demo, notes, automated_refresh_permitted, max_paid_calls_per_job)
values
  ('fixture_demo', 'Synthetic fixture provider (DEMO)', 'fixture', 'active', null, true,
   'Deterministic synthetic data for development and demos. Not real properties, sales, auctions or sheriffs.', true, null),
  ('lightstone', 'Lightstone', 'property_data', 'candidate', 'https://portal.apis.lightstone.co.za/', false,
   'Investigate property/deeds, transfer history, comps, AVM and suburb APIs. Request docs, samples, coverage, costs, retention and display rights.', null, null),
  ('property24_data', 'Property24 Property Data', 'property_data', 'candidate', 'https://www.property24.com/products/property-data', false,
   'Programmatic access and reuse rights UNCONFIRMED. Seek authorised commercial access; no scraping.', null, null),
  ('windeed', 'Lexis WinDeed', 'property_data', 'candidate', 'https://www.windeed.co.za/', false,
   'Deeds, transfers, address/erf matching, valuation products. Programmatic access and retention rights UNCONFIRMED.', null, null),
  ('deeds_registry', 'Deeds registry / authorised resellers', 'property_data', 'candidate', null, false,
   'Evaluate official access channels for authoritative legal identifiers and transfer verification.', null, null),
  ('aucor', 'Aucor Property', 'auctions', 'candidate', 'https://www.aucorproperty.co.za/', false,
   'Auction listings and documents; API/feed UNCONFIRMED.', null, null),
  ('gemfinder', 'GemFinder', 'sheriff_notices', 'candidate', 'https://www.gemfinder.co.za/', false,
   'Sheriff auction aggregation; licensing and API/feed UNCONFIRMED.', null, null),
  ('repolens', 'RepoLens', 'sheriff_notices', 'candidate', 'https://repolens.co.za/sheriff-auctions', false,
   'Sheriff/Gazette-derived data; licensing and API/feed UNCONFIRMED.', null, null),
  ('gpw_gazette', 'Government Printing Works — Gazettes', 'gazette', 'candidate', 'https://www.gpw.gov.za/Government-Gazettes/', false,
   'Official notices; may require permitted document ingestion and manual verification.', null, null)
on conflict (provider_key) do nothing;

insert into public.integration_capabilities (integration_id, capability)
select id, c from public.integrations,
  unnest(array['subject_property', 'nearby_sales', 'auctions', 'provider_incremental', 'full_reconciliation']) c
where provider_key = 'fixture_demo'
on conflict do nothing;

-- Daily 02:00 Africa/Johannesburg (provisional default from CLAUDE.md). Disabled until a Super Admin enables it.
insert into public.sync_schedules (integration_id, scope, cron, timezone, enabled)
select id, s, case s when 'auctions' then '0 6,18 * * *' else '0 2 * * *' end, 'Africa/Johannesburg', false
from public.integrations, unnest(array['provider_incremental', 'auctions']) s
where provider_key = 'fixture_demo'
on conflict (integration_id, scope) do nothing;
