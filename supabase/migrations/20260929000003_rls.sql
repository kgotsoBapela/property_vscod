-- Row Level Security. Mirrors packages/shared/src/permissions (server routes check the same capabilities).
-- The worker uses the service role and bypasses RLS; browsers never receive the service key.

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;
alter table public.integrations enable row level security;
alter table public.integration_capabilities enable row level security;
alter table public.sync_schedules enable row level security;
alter table public.sync_jobs enable row level security;
alter table public.sync_job_events enable row level security;
alter table public.sync_checkpoints enable row level security;
alter table public.source_records enable row level security;
alter table public.properties enable row level security;
alter table public.property_identifiers enable row level security;
alter table public.identity_review_queue enable row level security;
alter table public.property_sales enable row level security;
alter table public.property_valuations enable row level security;
alter table public.comparable_sales enable row level security;
alter table public.market_statistics enable row level security;
alter table public.auction_houses enable row level security;
alter table public.sheriff_offices enable row level security;
alter table public.auctions enable row level security;
alter table public.auction_properties enable row level security;
alter table public.auction_documents enable row level security;
alter table public.property_watchlists enable row level security;
alter table public.analysis_scenarios enable row level security;
alter table public.analysis_reports enable row level security;

-- Profiles & roles ----------------------------------------------------------
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_role('super_admin', 'admin'));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy user_roles_read on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role('super_admin', 'admin'));
create policy user_roles_manage on public.user_roles for all to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));

-- Audit: Super Admin reads everything; others read their own. Writes only via write_audit().
create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_role('super_admin') or actor_id = auth.uid());

-- Property analysis data: any role may read -------------------------------------
create policy read_properties on public.properties for select to authenticated using (public.app_role() is not null);
create policy read_identifiers on public.property_identifiers for select to authenticated using (public.app_role() is not null);
create policy read_sales on public.property_sales for select to authenticated using (public.app_role() is not null);
create policy read_valuations on public.property_valuations for select to authenticated using (public.app_role() is not null);
create policy read_market on public.market_statistics for select to authenticated using (public.app_role() is not null);
create policy read_auction_houses on public.auction_houses for select to authenticated using (public.app_role() is not null);
create policy read_sheriffs on public.sheriff_offices for select to authenticated using (public.app_role() is not null);
create policy read_auctions on public.auctions for select to authenticated using (public.app_role() is not null);
create policy read_auction_props on public.auction_properties for select to authenticated using (public.app_role() is not null);
create policy read_auction_docs on public.auction_documents for select to authenticated using (public.app_role() is not null);
create policy read_comparables on public.comparable_sales for select to authenticated using (public.app_role() is not null);

-- Analyst decisions: Admin and Super Admin
create policy write_comparables on public.comparable_sales for all to authenticated
  using (public.has_role('super_admin', 'admin')) with check (public.has_role('super_admin', 'admin'));
create policy review_auction_props on public.auction_properties for update to authenticated
  using (public.has_role('super_admin', 'admin')) with check (public.has_role('super_admin', 'admin'));
create policy review_queue_read on public.identity_review_queue for select to authenticated
  using (public.has_role('super_admin', 'admin'));
create policy review_queue_update on public.identity_review_queue for update to authenticated
  using (public.has_role('super_admin', 'admin')) with check (public.has_role('super_admin', 'admin'));

-- Raw provider payloads may be licensed: Super Admin only.
create policy source_records_read on public.source_records for select to authenticated using (public.has_role('super_admin'));

-- Integrations & sync ------------------------------------------------------------
create policy integrations_read on public.integrations for select to authenticated using (public.has_role('super_admin', 'admin'));
create policy integrations_manage on public.integrations for update to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));
create policy capabilities_read on public.integration_capabilities for select to authenticated using (public.has_role('super_admin', 'admin'));
create policy schedules_read on public.sync_schedules for select to authenticated using (public.has_role('super_admin', 'admin'));
create policy schedules_manage on public.sync_schedules for update to authenticated
  using (public.has_role('super_admin')) with check (public.has_role('super_admin'));
create policy jobs_read on public.sync_jobs for select to authenticated using (public.has_role('super_admin', 'admin'));
create policy jobs_create on public.sync_jobs for insert to authenticated
  with check (public.has_role('super_admin') and trigger = 'manual' and requested_by = auth.uid() and status = 'queued');
create policy jobs_cancel on public.sync_jobs for update to authenticated
  using (public.has_role('super_admin') and status in ('queued', 'running'))
  with check (status in ('cancellation_requested', 'cancelled'));
create policy job_events_read on public.sync_job_events for select to authenticated using (public.has_role('super_admin', 'admin'));
create policy checkpoints_read on public.sync_checkpoints for select to authenticated using (public.has_role('super_admin'));

-- Personal workspace ---------------------------------------------------------------
create policy watchlist_own on public.property_watchlists for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.app_role() is not null);
create policy scenarios_own on public.analysis_scenarios for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.app_role() is not null);
create policy reports_own on public.analysis_reports for all to authenticated
  using (user_id = auth.uid() or public.has_role('super_admin')) with check (user_id = auth.uid());

-- Privileged functions: service role only ---------------------------------------------
revoke execute on function public.commit_sync_item(jsonb) from public, anon, authenticated;
revoke execute on function public.claim_next_sync_job(text) from public, anon, authenticated;
revoke execute on function public.fail_stale_jobs(interval) from public, anon, authenticated;
revoke execute on function public.find_property_candidates(jsonb) from public, anon, authenticated;
grant execute on function public.commit_sync_item(jsonb) to service_role;
grant execute on function public.claim_next_sync_job(text) to service_role;
grant execute on function public.fail_stale_jobs(interval) to service_role;
grant execute on function public.find_property_candidates(jsonb) to service_role;

revoke execute on function public.write_audit(text, text, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, jsonb) to authenticated, service_role;
revoke execute on function public.nearby_sales(uuid, integer, date) from public, anon;
grant execute on function public.nearby_sales(uuid, integer, date) to authenticated, service_role;
