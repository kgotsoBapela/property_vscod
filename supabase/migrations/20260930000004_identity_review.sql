-- Identity review resolution.
-- 1. Review items keep the normalized record so a reviewer's decision can be committed without re-fetching.
-- 2. Open review items are re-evaluated on every sync and closed automatically when matching resolves them.
-- 3. Updating a property replaces only identifiers from the same source record (merged records keep theirs).
-- 4. resolve_identity_review / resolve_auction_lot apply Admin / Super Admin decisions atomically, with audit.

alter table public.identity_review_queue
  add column record jsonb,
  add column source jsonb,
  add column street_key text;

alter table public.identity_review_queue drop constraint identity_review_queue_resolution_check;
alter table public.identity_review_queue add constraint identity_review_queue_resolution_check
  check (resolution in ('merged', 'created_new', 'rejected', 'resolved_by_sync'));

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
      insert into public.identity_review_queue (provider, external_id, description, candidates, reason, source_record_id,
        record, source, street_key)
      values (v_provider, v_rec ->> 'external_id', v_rec ->> 'address', p_item -> 'resolution' -> 'review' -> 'candidates',
              p_item -> 'resolution' -> 'review' ->> 'reason', v_source_id, v_rec, v_src, p_item ->> 'street_key')
      on conflict (provider, external_id) where status = 'open'
      do update set candidates = excluded.candidates, reason = excluded.reason, record = excluded.record,
                    source = excluded.source, street_key = excluded.street_key;
      return null;
    end if;

    -- Resolved without review now (e.g. improved matching): close any open review for this record.
    update public.identity_review_queue set status = 'resolved', resolution = 'resolved_by_sync', resolved_at = now()
     where provider = v_provider and external_id = v_rec ->> 'external_id' and status = 'open';

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
    -- Replace only identifiers from THIS source record; other records merged into the property keep theirs.
    delete from public.property_identifiers
     where property_id = v_property_id and provider = v_provider
       and (external_id = v_rec ->> 'external_id' or source_record_id = v_source_id);
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
        v_ident_status, v_source_id, v_retrieved, v_demo)
      on conflict do nothing;
    elsif v_rec ->> 'erf_number' is not null then
      insert into public.property_identifiers (property_id, kind, erf_number, portion, township, title_deed, provider,
        verification_status, source_record_id, retrieved_at, is_demo)
      values (v_property_id, 'erf', v_rec ->> 'erf_number', v_rec ->> 'portion', v_rec ->> 'township', v_rec ->> 'title_deed',
        v_provider, v_ident_status, v_source_id, v_retrieved, v_demo)
      on conflict do nothing;
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

create or replace function public.resolve_identity_review(p_review_id uuid, p_action text, p_property_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  q public.identity_review_queue;
  v_property_id uuid;
begin
  if not public.has_role('super_admin', 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_action not in ('merge', 'create_new', 'reject') then
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;

  select * into q from public.identity_review_queue where id = p_review_id and status = 'open' for update;
  if q.id is null then
    raise exception 'Review item not found or already resolved' using errcode = 'P0002';
  end if;
  if p_action <> 'reject' and q.record is null then
    raise exception 'This item predates stored review records; run a sync to refresh it' using errcode = '55000';
  end if;
  if p_action = 'merge' and not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Choose the property to merge into' using errcode = '22023';
  end if;

  if p_action <> 'reject' then
    v_property_id := public.commit_sync_item(jsonb_build_object(
      'kind', 'property',
      'source', q.source,
      'record', q.record,
      'street_key', q.street_key,
      'resolution', jsonb_build_object(
        'property_id', case when p_action = 'merge' then p_property_id end,
        'confidence', 1,
        'evidence', jsonb_build_array('Confirmed by reviewer'),
        'review', null)));
  end if;

  update public.identity_review_queue
     set status = 'resolved',
         resolution = case p_action when 'merge' then 'merged' when 'create_new' then 'created_new' else 'rejected' end,
         resolved_property_id = v_property_id, resolved_by = auth.uid(), resolved_at = now()
   where id = p_review_id;

  perform public.write_audit('identity_review.' || p_action, p_review_id::text,
    jsonb_build_object('provider', q.provider, 'external_id', q.external_id, 'property_id', v_property_id));
  return v_property_id;
end $$;

create or replace function public.resolve_auction_lot(p_auction_id uuid, p_lot_index integer, p_action text, p_property_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.has_role('super_admin', 'admin') then
    raise exception 'Not permitted' using errcode = '42501';
  end if;
  if p_action not in ('confirm', 'reject') then
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
  if p_action = 'confirm' and not exists (select 1 from public.properties where id = p_property_id) then
    raise exception 'Choose the matching property' using errcode = '22023';
  end if;

  update public.auction_properties
     set property_id = case when p_action = 'confirm' then p_property_id end,
         review_status = case when p_action = 'confirm' then 'confirmed' else 'rejected' end,
         match_confidence = case when p_action = 'confirm' then 1 else 0 end,
         match_evidence = array[case when p_action = 'confirm' then 'Confirmed by reviewer' else 'Rejected by reviewer' end] || match_evidence,
         reviewed_by = auth.uid(), reviewed_at = now()
   where auction_id = p_auction_id and lot_index = p_lot_index
  returning id into v_id;
  if v_id is null then
    raise exception 'Auction lot not found' using errcode = 'P0002';
  end if;

  perform public.write_audit('auction_lot.' || p_action, p_auction_id::text || ':' || p_lot_index,
    jsonb_build_object('property_id', p_property_id));
end $$;

revoke execute on function public.resolve_identity_review(uuid, text, uuid) from public, anon;
revoke execute on function public.resolve_auction_lot(uuid, integer, text, uuid) from public, anon;
grant execute on function public.resolve_identity_review(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.resolve_auction_lot(uuid, integer, text, uuid) to authenticated, service_role;
-- commit_sync_item was re-created above; keep it service-role only.
revoke execute on function public.commit_sync_item(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sync_item(jsonb) to service_role;
