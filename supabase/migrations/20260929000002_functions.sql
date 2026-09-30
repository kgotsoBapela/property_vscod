-- Functions: role helpers, auth hooks, job queue, atomic sync commits, search and comparables.

-- ---------------------------------------------------------------------------
-- Role helpers (used by RLS). SECURITY DEFINER so policies can read user_roles.
-- ---------------------------------------------------------------------------
create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create or replace function public.has_role(variadic roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = any (roles))
$$;

-- Invitation-only onboarding: the role comes from app_metadata, which only the service role can set.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, '')) on conflict (id) do nothing;
  if v_role in ('super_admin', 'admin', 'viewer') then
    insert into public.user_roles (user_id, role, granted_by)
    values (new.id, v_role, nullif(new.raw_app_meta_data ->> 'invited_by', '')::uuid)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.write_audit(p_action text, p_target text, p_details jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, actor_label, action, target, details)
  values (auth.uid(), coalesce((select email from public.profiles where id = auth.uid()), 'system'), p_action, p_target, p_details);
end $$;

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------
-- Atomically claim the oldest queued job. SKIP LOCKED lets several workers run safely.
create or replace function public.claim_next_sync_job(p_worker_id text) returns setof public.sync_jobs
language plpgsql security definer set search_path = public as $$
begin
  return query
  update public.sync_jobs j
     set status = 'running', worker_id = p_worker_id, started_at = coalesce(j.started_at, now()), heartbeat_at = now()
   where j.id = (
     select id from public.sync_jobs
      where status = 'queued'
      order by created_at
      for update skip locked
      limit 1
   )
  returning j.*;
end $$;

-- Jobs whose worker stopped heart-beating are failed (not silently retried) so a human can inspect them.
create or replace function public.fail_stale_jobs(p_after interval default interval '10 minutes') returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with stale as (
    update public.sync_jobs set status = 'failed', finished_at = now(), error_category = 'worker_lost',
           error_message = 'Worker heartbeat lost; prior data preserved'
     where status in ('running', 'cancellation_requested') and heartbeat_at < now() - p_after
    returning id
  )
  insert into public.sync_job_events (job_id, level, message) select id, 'error', 'Marked failed: worker heartbeat lost' from stale;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Identity candidates for the matcher (packages/shared/src/matching/identity.ts)
-- ---------------------------------------------------------------------------
create or replace function public.find_property_candidates(p_facts jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (
    select
      nullif(p_facts ->> 'erf_number', '') as erf,
      lower(nullif(p_facts ->> 'scheme_number', '')) as scheme_no,
      lower(nullif(p_facts ->> 'scheme_name', '')) as scheme_name,
      nullif(p_facts ->> 'street_key', '') as street_key,
      (p_facts ->> 'latitude')::double precision as lat,
      (p_facts ->> 'longitude')::double precision as lon,
      coalesce(p_facts -> 'provider_ids', '[]'::jsonb) as provider_ids
  ),
  hits as (
    select distinct p.id
      from public.properties p, f
     where (f.street_key is not null and p.street_key = f.street_key)
        or (f.lat is not null and p.latitude between f.lat - 0.0005 and f.lat + 0.0005
                              and p.longitude between f.lon - 0.0005 and f.lon + 0.0005)
        or exists (
          select 1 from public.property_identifiers i
           where i.property_id = p.id
             and ((f.erf is not null and i.erf_number = f.erf)
               or (f.scheme_no is not null and lower(i.scheme_number) = f.scheme_no)
               or (f.scheme_name is not null and lower(i.scheme_name) = f.scheme_name)
               or (i.kind = 'provider_property_id' and exists (
                     select 1 from jsonb_array_elements(f.provider_ids) x
                      where x ->> 'provider' = i.provider and x ->> 'external_id' = i.external_id)))
        )
     limit 200
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'property_id', p.id,
    'address', coalesce(p.street_key, lower(p.normalized_address)),
    'erf_number', legal.erf_number,
    'portion', legal.portion,
    'township', legal.township,
    'scheme_name', legal.scheme_name,
    'scheme_number', legal.scheme_number,
    'unit_number', legal.unit_number,
    'latitude', p.latitude,
    'longitude', p.longitude,
    'provider_ids', coalesce((
      select jsonb_agg(jsonb_build_object('provider', i.provider, 'external_id', i.external_id))
        from public.property_identifiers i where i.property_id = p.id and i.kind = 'provider_property_id'), '[]'::jsonb)
  )), '[]'::jsonb)
  from hits h
  join public.properties p on p.id = h.id
  left join lateral (
    select * from public.property_identifiers i
     where i.property_id = p.id and i.kind in ('sectional_scheme_unit', 'erf')
     order by (i.kind = 'sectional_scheme_unit') desc, (i.verification_status = 'verified') desc
     limit 1
  ) legal on true
$$;

-- ---------------------------------------------------------------------------
-- Atomic commit of one normalized record (mirrors MemorySyncStore.commitItem).
-- A function body runs in a single transaction: either everything is written or nothing is.
-- ---------------------------------------------------------------------------
create or replace function public.commit_sync_item(p_item jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := p_item ->> 'kind';
  v_src jsonb := p_item -> 'source';
  v_rec jsonb := p_item -> 'record';
  v_provider text := v_src ->> 'provider';
  v_retrieved timestamptz := (v_src ->> 'retrieved_at')::timestamptz;
  v_demo boolean := coalesce((v_src ->> 'is_demo')::boolean, false);
  v_source_id uuid;
  v_property_id uuid;
  v_auction_id uuid;
  v_sheriff_id uuid;
  v_house_id uuid;
  v_prev record;
  v_history jsonb;
  v_ident_status text;
begin
  insert into public.source_records as s (provider, external_id, content_hash, raw, retrieved_at, first_retrieved_at, retention_until, is_demo, last_job_id)
  values (v_provider, v_src ->> 'external_id', v_src ->> 'content_hash', v_src -> 'raw', v_retrieved, v_retrieved,
          (v_src ->> 'retention_until')::timestamptz, v_demo, (p_item ->> 'job_id')::uuid)
  on conflict (provider, external_id) do update
     set content_hash = excluded.content_hash, raw = excluded.raw, retrieved_at = excluded.retrieved_at,
         retention_until = excluded.retention_until, last_job_id = excluded.last_job_id
  returning s.id into v_source_id;

  if v_kind = 'unchanged' then
    update public.property_sales set retrieved_at = v_retrieved where source_record_id = v_source_id;
    update public.property_valuations set retrieved_at = v_retrieved where source_record_id = v_source_id;
    update public.auctions set retrieved_at = v_retrieved where source_record_id = v_source_id;
    update public.sheriff_offices set retrieved_at = v_retrieved where source_record_id = v_source_id;
    select property_id into v_property_id from public.property_identifiers
     where source_record_id = v_source_id and kind = 'provider_property_id' limit 1;
    return v_property_id;
  end if;

  if v_kind = 'property' then
    if jsonb_typeof(p_item -> 'resolution' -> 'review') = 'object' then
      insert into public.identity_review_queue (provider, external_id, description, candidates, reason, source_record_id)
      values (v_provider, v_rec ->> 'external_id', v_rec ->> 'address', p_item -> 'resolution' -> 'review' -> 'candidates',
              p_item -> 'resolution' -> 'review' ->> 'reason', v_source_id)
      on conflict (provider, external_id) where status = 'open'
      do update set candidates = excluded.candidates, reason = excluded.reason;
      return null;
    end if;

    v_property_id := nullif(p_item -> 'resolution' ->> 'property_id', '')::uuid;
    if v_property_id is null then
      select property_id into v_property_id from public.property_identifiers
       where provider = v_provider and external_id = v_rec ->> 'external_id' and kind = 'provider_property_id';
    end if;

    if v_property_id is null then
      insert into public.properties (normalized_address, street_number, street_name, unit_number, complex_name, suburb,
        municipality, province, postal_code, latitude, longitude, property_type, erf_size_m2, floor_size_m2, bedrooms,
        bathrooms, is_demo, street_key, updated_at)
      values (v_rec ->> 'address', v_rec ->> 'street_number', v_rec ->> 'street_name', v_rec ->> 'unit_number',
        v_rec ->> 'complex_name', v_rec ->> 'suburb', v_rec ->> 'municipality', v_rec ->> 'province', v_rec ->> 'postal_code',
        (v_rec ->> 'latitude')::double precision, (v_rec ->> 'longitude')::double precision, v_rec ->> 'property_type',
        (v_rec ->> 'erf_size_m2')::numeric, (v_rec ->> 'floor_size_m2')::numeric, (v_rec ->> 'bedrooms')::smallint,
        (v_rec ->> 'bathrooms')::numeric, v_demo, p_item ->> 'street_key', v_retrieved)
      returning id into v_property_id;
    else
      update public.properties set
        normalized_address = v_rec ->> 'address', street_number = v_rec ->> 'street_number', street_name = v_rec ->> 'street_name',
        unit_number = v_rec ->> 'unit_number', complex_name = v_rec ->> 'complex_name', suburb = v_rec ->> 'suburb',
        municipality = v_rec ->> 'municipality', province = v_rec ->> 'province', postal_code = v_rec ->> 'postal_code',
        latitude = (v_rec ->> 'latitude')::double precision, longitude = (v_rec ->> 'longitude')::double precision,
        property_type = v_rec ->> 'property_type', erf_size_m2 = (v_rec ->> 'erf_size_m2')::numeric,
        floor_size_m2 = (v_rec ->> 'floor_size_m2')::numeric, bedrooms = (v_rec ->> 'bedrooms')::smallint,
        bathrooms = (v_rec ->> 'bathrooms')::numeric, street_key = p_item ->> 'street_key', updated_at = v_retrieved
      where id = v_property_id;
    end if;

    v_ident_status := case when (v_rec ->> 'identifiers_verified')::boolean then 'verified' else 'unverified' end;
    delete from public.property_identifiers where property_id = v_property_id and provider = v_provider;
    insert into public.property_identifiers (property_id, kind, provider, external_id, verification_status,
      match_confidence, match_evidence, source_record_id, retrieved_at, is_demo)
    values (v_property_id, 'provider_property_id', v_provider, v_rec ->> 'external_id', 'verified',
      (p_item -> 'resolution' ->> 'confidence')::numeric,
      array(select jsonb_array_elements_text(coalesce(p_item -> 'resolution' -> 'evidence', '[]'::jsonb))),
      v_source_id, v_retrieved, v_demo);
    if coalesce(v_rec ->> 'scheme_name', v_rec ->> 'scheme_number') is not null then
      insert into public.property_identifiers (property_id, kind, erf_number, portion, township, scheme_name, scheme_number,
        unit_number, title_deed, provider, verification_status, source_record_id, retrieved_at, is_demo)
      values (v_property_id, 'sectional_scheme_unit', v_rec ->> 'erf_number', v_rec ->> 'portion', v_rec ->> 'township',
        v_rec ->> 'scheme_name', v_rec ->> 'scheme_number', v_rec ->> 'unit_number', v_rec ->> 'title_deed', v_provider,
        v_ident_status, v_source_id, v_retrieved, v_demo);
    elsif v_rec ->> 'erf_number' is not null then
      insert into public.property_identifiers (property_id, kind, erf_number, portion, township, title_deed, provider,
        verification_status, source_record_id, retrieved_at, is_demo)
      values (v_property_id, 'erf', v_rec ->> 'erf_number', v_rec ->> 'portion', v_rec ->> 'township', v_rec ->> 'title_deed',
        v_provider, v_ident_status, v_source_id, v_retrieved, v_demo);
    end if;

    insert into public.property_sales as ps (property_id, provider, external_id, transfer_amount, sale_date, registration_date,
      transfer_type, is_arms_length, title_deed, verification_status, source_record_id, retrieved_at, is_demo)
    select v_property_id, v_provider, s.external_id, s.transfer_amount, s.sale_date, s.registration_date, s.transfer_type,
           s.is_arms_length, s.title_deed, s.verification_status, v_source_id, v_retrieved, v_demo
      from jsonb_to_recordset(coalesce(v_rec -> 'sales', '[]'::jsonb)) as s(
        external_id text, transfer_amount numeric, sale_date date, registration_date date, transfer_type text,
        is_arms_length boolean, title_deed text, verification_status text)
    on conflict (provider, external_id) do update set
      property_id = excluded.property_id, transfer_amount = excluded.transfer_amount, sale_date = excluded.sale_date,
      registration_date = excluded.registration_date, transfer_type = excluded.transfer_type,
      is_arms_length = excluded.is_arms_length, title_deed = excluded.title_deed,
      verification_status = excluded.verification_status, source_record_id = excluded.source_record_id,
      retrieved_at = excluded.retrieved_at;

    insert into public.property_valuations (property_id, provider, external_id, model, methodology_version, point_estimate,
      range_low, range_high, as_of_date, confidence, confidence_notes, source_record_id, retrieved_at, is_demo)
    select v_property_id, v_provider, v.external_id, v.model, v.methodology_version, v.point_estimate, v.range_low,
           v.range_high, v.as_of_date, v.confidence, v.confidence_notes, v_source_id, v_retrieved, v_demo
      from jsonb_to_recordset(coalesce(v_rec -> 'valuations', '[]'::jsonb)) as v(
        external_id text, model text, methodology_version text, point_estimate numeric, range_low numeric,
        range_high numeric, as_of_date date, confidence text, confidence_notes text)
    on conflict (provider, external_id) do update set
      property_id = excluded.property_id, model = excluded.model, methodology_version = excluded.methodology_version,
      point_estimate = excluded.point_estimate, range_low = excluded.range_low, range_high = excluded.range_high,
      as_of_date = excluded.as_of_date, confidence = excluded.confidence, confidence_notes = excluded.confidence_notes,
      source_record_id = excluded.source_record_id, retrieved_at = excluded.retrieved_at;

    return v_property_id;
  end if;

  if v_kind = 'auction' then
    if jsonb_typeof(v_rec -> 'sheriff_office') = 'object' then
      insert into public.sheriff_offices as so (provider, external_id, name, jurisdiction, province, physical_address, phone,
        email, contact_verified_at, verification_status, source_url, source_record_id, retrieved_at, is_demo)
      select v_provider, x.external_id, x.name, x.jurisdiction, x.province, x.physical_address, x.phone, x.email,
             x.contact_verified_at, case when x.contact_verified_at is null then 'unverified' else 'verified' end,
             x.source_url, v_source_id, v_retrieved, v_demo
        from jsonb_to_record(v_rec -> 'sheriff_office') as x(external_id text, name text, jurisdiction text, province text,
          physical_address text, phone text, email text, contact_verified_at timestamptz, source_url text)
      on conflict (provider, external_id) do update set
        name = excluded.name, jurisdiction = excluded.jurisdiction, province = excluded.province,
        physical_address = excluded.physical_address, phone = excluded.phone, email = excluded.email,
        contact_verified_at = excluded.contact_verified_at, verification_status = excluded.verification_status,
        source_url = excluded.source_url, source_record_id = excluded.source_record_id, retrieved_at = excluded.retrieved_at
      returning so.id into v_sheriff_id;
    end if;

    if jsonb_typeof(v_rec -> 'auction_house') = 'object' then
      insert into public.auction_houses as ah (provider, external_id, name, website, is_demo)
      values (v_provider, v_rec -> 'auction_house' ->> 'external_id', v_rec -> 'auction_house' ->> 'name',
              v_rec -> 'auction_house' ->> 'website', v_demo)
      on conflict (provider, external_id) do update set name = excluded.name, website = excluded.website
      returning ah.id into v_house_id;
    end if;

    select id, status, status_history into v_prev from public.auctions
     where provider = v_provider and external_id = v_rec ->> 'external_id';
    v_history := coalesce(v_prev.status_history, '[]'::jsonb);
    if v_prev.id is null or v_prev.status is distinct from v_rec ->> 'status' then
      v_history := v_history || jsonb_build_array(jsonb_build_object(
        'status', v_rec ->> 'status', 'at', v_retrieved, 'note', v_rec ->> 'status_note'));
    end if;

    insert into public.auctions as a (provider, external_id, kind, auction_house_id, sheriff_office_id, title, event_at, venue,
      status, status_history, prices, deposit_terms, conditions_summary, case_reference, notice_url, last_verified_at,
      verification_status, source_record_id, retrieved_at, is_demo)
    values (v_provider, v_rec ->> 'external_id', v_rec ->> 'kind', v_house_id, v_sheriff_id, v_rec ->> 'title',
      (v_rec ->> 'event_at')::timestamptz, v_rec ->> 'venue', v_rec ->> 'status', v_history, coalesce(v_rec -> 'prices', '[]'::jsonb),
      v_rec ->> 'deposit_terms', v_rec ->> 'conditions_summary', v_rec ->> 'case_reference', v_rec ->> 'notice_url',
      (v_rec ->> 'verified_at')::timestamptz,
      case when v_rec ->> 'verified_at' is null then 'unverified' else 'verified' end, v_source_id, v_retrieved, v_demo)
    on conflict (provider, external_id) do update set
      kind = excluded.kind, auction_house_id = excluded.auction_house_id, sheriff_office_id = excluded.sheriff_office_id,
      title = excluded.title, event_at = excluded.event_at, venue = excluded.venue, status = excluded.status,
      status_history = excluded.status_history, prices = excluded.prices, deposit_terms = excluded.deposit_terms,
      conditions_summary = excluded.conditions_summary, case_reference = excluded.case_reference,
      notice_url = excluded.notice_url, last_verified_at = excluded.last_verified_at,
      verification_status = excluded.verification_status, source_record_id = excluded.source_record_id,
      retrieved_at = excluded.retrieved_at
    returning a.id into v_auction_id;

    -- Replace machine lot links but keep human decisions (confirmed/rejected).
    delete from public.auction_properties
     where auction_id = v_auction_id and review_status in ('auto_matched', 'needs_review');
    insert into public.auction_properties (auction_id, lot_index, property_id, candidate_property_ids, lot_number,
      described_address, described_erf, match_confidence, match_evidence, review_status)
    select v_auction_id, (r ->> 'lot_index')::int, nullif(r ->> 'property_id', '')::uuid,
           array(select jsonb_array_elements_text(coalesce(r -> 'candidate_property_ids', '[]'::jsonb)))::uuid[],
           lx.lot ->> 'lot_number', lx.lot ->> 'described_address', lx.lot ->> 'erf_number',
           (r ->> 'confidence')::numeric, array(select jsonb_array_elements_text(coalesce(r -> 'evidence', '[]'::jsonb))),
           r ->> 'review_status'
      from jsonb_array_elements(coalesce(p_item -> 'lots', '[]'::jsonb)) as res(r)
      cross join lateral (select v_rec -> 'lots' -> (r ->> 'lot_index')::int) as lx(lot)
    on conflict (auction_id, lot_index) do nothing;

    insert into public.auction_documents (auction_id, provider, external_id, kind, title, url, published_at, retrieved_at, is_demo)
    select v_auction_id, v_provider, d.external_id, d.kind, d.title, d.url, d.published_at, v_retrieved, v_demo
      from jsonb_to_recordset(coalesce(v_rec -> 'documents', '[]'::jsonb)) as d(
        external_id text, kind text, title text, url text, published_at timestamptz)
    on conflict (provider, external_id) do update set
      auction_id = excluded.auction_id, kind = excluded.kind, title = excluded.title, url = excluded.url,
      published_at = excluded.published_at, retrieved_at = excluded.retrieved_at;

    return null;
  end if;

  raise exception 'Unknown commit item kind: %', v_kind;
end $$;

-- ---------------------------------------------------------------------------
-- Read helpers (SECURITY INVOKER so RLS applies to the caller)
-- ---------------------------------------------------------------------------
create or replace function public.haversine_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2))))
$$;

-- Candidate comparable sales around a subject. Filtering/adjustment happens in analyzeComparables (shared).
create or replace function public.nearby_sales(p_property_id uuid, p_radius_m integer, p_since date)
returns table (
  sale jsonb,
  property jsonb,
  distance_m double precision
) language sql stable security invoker set search_path = public as $$
  with subj as (select latitude, longitude from public.properties where id = p_property_id and latitude is not null)
  select to_jsonb(s) as sale, to_jsonb(p) as property,
         public.haversine_m(subj.latitude, subj.longitude, p.latitude, p.longitude) as distance_m
    from subj
    join public.properties p
      on p.latitude between subj.latitude - (p_radius_m / 111000.0) and subj.latitude + (p_radius_m / 111000.0)
     and p.longitude between subj.longitude - (p_radius_m / 100000.0) and subj.longitude + (p_radius_m / 100000.0)
    join public.property_sales s on s.property_id = p.id
   where coalesce(s.registration_date, s.sale_date) >= p_since
     and public.haversine_m(subj.latitude, subj.longitude, p.latitude, p.longitude) <= p_radius_m
   order by distance_m
   limit 500
$$;
