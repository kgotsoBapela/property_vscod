// Canonical domain types shared by the web app, the worker and tests.
// Field names mirror the Supabase schema (snake_case) so rows map without renaming.

export type Role = "super_admin" | "admin" | "viewer";

export type VerificationStatus = "verified" | "unverified" | "disputed" | "superseded";

/**
 * Every monetary figure shown in the UI must carry one of these meanings.
 * They are never interchangeable (see CLAUDE.md "UX and screens").
 */
export type PriceKind =
  | "registered_transfer"
  | "asking_price"
  | "avm_estimate"
  | "auction_guide"
  | "auction_reserve"
  | "opening_bid"
  | "confirmed_hammer";

export type PropertyType = "freehold" | "sectional_title" | "agricultural" | "vacant_land" | "commercial";

export type TransferType =
  | "market_sale"
  | "sale_in_execution"
  | "deceased_estate"
  | "donation"
  | "related_party"
  | "divorce"
  | "other";

export type IdentifierKind =
  | "erf"
  | "farm_portion"
  | "sectional_scheme_unit"
  | "title_deed"
  | "provider_property_id";

export interface Provenance {
  provider: string;
  source_record_id: string | null;
  retrieved_at: string; // ISO timestamp
  is_demo: boolean;
}

export interface Property {
  id: string;
  normalized_address: string;
  street_number: string | null;
  street_name: string | null;
  unit_number: string | null;
  complex_name: string | null;
  suburb: string;
  municipality: string | null;
  province: string;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  property_type: PropertyType;
  erf_size_m2: number | null;
  floor_size_m2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  is_demo: boolean;
  updated_at: string;
}

export interface PropertyIdentifier {
  id: string;
  property_id: string;
  kind: IdentifierKind;
  // erf / portion / township, or scheme name / scheme number / unit
  erf_number: string | null;
  portion: string | null;
  township: string | null;
  scheme_name: string | null;
  scheme_number: string | null;
  unit_number: string | null;
  title_deed: string | null;
  provider: string | null;
  external_id: string | null;
  verification_status: VerificationStatus;
  provenance: Provenance;
}

export interface PropertySale {
  id: string;
  property_id: string;
  transfer_amount: number | null; // ZAR; null when not disclosed
  sale_date: string | null; // date the agreement was signed, if known
  registration_date: string | null; // Deeds Office registration date
  transfer_type: TransferType;
  is_arms_length: boolean;
  title_deed: string | null;
  verification_status: VerificationStatus;
  provenance: Provenance;
}

export interface PropertyValuation {
  id: string;
  property_id: string;
  provider: string;
  model: string;
  methodology_version: string;
  point_estimate: number | null;
  range_low: number | null;
  range_high: number | null;
  as_of_date: string;
  confidence: "high" | "medium" | "low" | "insufficient_data";
  confidence_notes: string | null;
  provenance: Provenance;
}

export interface MarketStatistic {
  id: string;
  geography_kind: "suburb" | "municipality" | "province";
  geography_name: string;
  property_type: PropertyType | "all";
  period_start: string;
  period_end: string;
  sample_count: number;
  median_price: number | null;
  mean_price: number | null;
  median_price_per_m2: number | null;
  provenance: Provenance;
}

export type AuctionStatus = "scheduled" | "postponed" | "cancelled" | "sold" | "no_sale" | "withdrawn" | "unknown";
export type AuctionKind = "sheriff_sale" | "private_auction" | "online_auction";

export interface AuctionPrice {
  kind: Extract<PriceKind, "auction_guide" | "auction_reserve" | "opening_bid" | "confirmed_hammer">;
  amount: number | null; // null = published as "not disclosed"
  published: boolean;
}

export interface Auction {
  id: string;
  kind: AuctionKind;
  auction_house_id: string | null;
  auction_house_name: string | null;
  sheriff_office_id: string | null;
  title: string;
  event_at: string | null; // ISO timestamp with timezone
  venue: string | null;
  status: AuctionStatus;
  status_history: { status: AuctionStatus; at: string; note: string | null }[];
  prices: AuctionPrice[];
  deposit_terms: string | null;
  conditions_summary: string | null;
  case_reference: string | null;
  notice_url: string | null;
  last_verified_at: string | null;
  verification_status: VerificationStatus;
  provenance: Provenance;
}

export interface AuctionPropertyLink {
  auction_id: string;
  property_id: string | null;
  lot_number: string | null;
  described_address: string;
  described_erf: string | null;
  match_confidence: number; // 0..1
  match_evidence: string[];
  review_status: "auto_matched" | "needs_review" | "confirmed" | "rejected";
}

export interface AuctionDocument {
  id: string;
  auction_id: string;
  kind: "notice" | "conditions_of_sale" | "gazette" | "other";
  title: string;
  url: string | null;
  storage_path: string | null;
  published_at: string | null;
  provenance: Provenance;
}

export interface SheriffOffice {
  id: string;
  name: string;
  jurisdiction: string;
  province: string;
  physical_address: string | null;
  phone: string | null;
  email: string | null;
  contact_verified_at: string | null;
  verification_status: VerificationStatus;
  source_url: string | null;
  provenance: Provenance;
}

export type SyncScope = "subject_property" | "nearby_sales" | "auctions" | "provider_incremental" | "full_reconciliation";

export type SyncStatus =
  | "queued"
  | "running"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancellation_requested"
  | "cancelled";

export interface SyncJob {
  id: string;
  integration_id: string;
  scope: SyncScope;
  target_property_id: string | null;
  params: Record<string, unknown>;
  status: SyncStatus;
  trigger: "schedule" | "manual";
  requested_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  records_fetched: number;
  records_upserted: number;
  records_failed: number;
  estimated_cost_zar: number | null;
  error_category: string | null;
  error_message: string | null;
}

export interface SyncJobEvent {
  id: string;
  job_id: string;
  at: string;
  level: "info" | "warn" | "error";
  message: string;
  data: Record<string, unknown> | null;
}

export type IntegrationStatus = "candidate" | "in_discussion" | "sandbox" | "active" | "suspended" | "rejected";

export interface Integration {
  id: string;
  provider_key: string;
  display_name: string;
  category: "property_data" | "auctions" | "sheriff_notices" | "gazette" | "fixture";
  status: IntegrationStatus;
  website: string | null;
  is_demo: boolean;
  capabilities: string[];
  notes: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  schedule_cron: string | null;
  schedule_timezone: string;
  schedule_enabled: boolean;
  // Provider matrix (docs/provider-matrix.md). null = unknown, never guessed.
  auth_method: string | null;
  historical_coverage: string | null;
  geographic_coverage: string | null;
  update_frequency: string | null;
  quota_per_day: number | null;
  cost_per_call_zar: number | null;
  monthly_cost_zar: number | null;
  display_rights: string | null;
  retention_rights: string | null;
  automated_refresh_permitted: boolean | null;
  contact_owner: string | null;
  max_paid_calls_per_job: number | null;
}

/** Credential metadata only. Values never leave Supabase Vault except to the worker. */
export interface IntegrationSecretMeta {
  name: string;
  hint: string | null;
  set_at: string;
  set_by_label: string | null;
}

export interface AuditLog {
  id: string;
  at: string;
  actor_id: string | null;
  actor_label: string;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
}

export interface ComparableCandidate {
  sale: PropertySale;
  property: Property;
  distance_m: number;
}
