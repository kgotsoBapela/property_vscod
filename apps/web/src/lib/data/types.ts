import type {
  Auction,
  AuctionDocument,
  AuditLog,
  ComparableCandidate,
  CreateSyncJobInput,
  Integration,
  MarketPoint,
  Property,
  PropertyIdentifier,
  PropertySale,
  PropertyValuation,
  Role,
  SheriffOffice,
  SyncJob,
  SyncJobEvent,
} from "@propintel/shared";

export interface Actor {
  id: string;
  label: string;
  role: Role;
}

export interface SearchResult {
  property: Property;
  identifiers: PropertyIdentifier[];
  match_reasons: string[];
  score: number;
}

export interface AuctionMatch {
  auction: Auction;
  lot_number: string | null;
  described_address: string;
  review_status: "auto_matched" | "needs_review" | "confirmed" | "rejected";
  match_confidence: number;
  match_evidence: string[];
  sheriff_name: string | null;
}

export interface FreshnessRow {
  provider: string;
  display_name: string;
  is_demo: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  latest_record_at: string | null;
}

export interface PropertyDetail {
  property: Property;
  identifiers: PropertyIdentifier[];
  sales: PropertySale[];
  valuations: PropertyValuation[];
  auctions: AuctionMatch[];
  market_series: MarketPoint[];
  sources: { provider: string; retrieved_at: string; is_demo: boolean }[];
  watchlisted: boolean;
}

export interface AuctionListItem {
  auction: Auction;
  sheriff: Pick<SheriffOffice, "id" | "name"> | null;
  lots: { described_address: string; property_id: string | null; review_status: string; candidate_count: number }[];
}

export interface AuctionDetail {
  auction: Auction;
  sheriff: SheriffOffice | null;
  documents: AuctionDocument[];
  lots: (AuctionMatch & { property: Property | null; candidates: Property[] })[];
}

export interface ReviewQueueItem {
  id: string;
  created_at: string;
  provider: string;
  external_id: string;
  description: string;
  reason: string;
  candidates: { property_id: string; confidence: number; evidence: string[]; conflicts: string[] }[];
}

export interface Overview {
  counts: { properties: number; registered_sales: number; upcoming_auctions: number; open_reviews: number; lots_needing_review: number };
  freshness: FreshnessRow[];
  upcoming: AuctionListItem[];
  watchlist: Property[];
  recent_jobs: SyncJob[];
  suburbs: { suburb: string; sales_12m: number; median_12m: number | null }[];
}

export interface SyncScheduleRow {
  id: string;
  integration_id: string;
  scope: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  next_run_at: string | null;
}

export interface UserRow {
  id: string;
  email: string;
  role: Role | null;
  created_at: string;
}

export class NotAllowedError extends Error {}
export class ConflictError extends Error {}

/**
 * Data access used by server components and route handlers. Two implementations:
 * DemoRepository (in-memory synthetic data) and SupabaseRepository (Postgres via RLS-scoped session).
 * Callers check capabilities first; implementations must still rely on RLS for Supabase.
 */
export interface DataRepository {
  readonly mode: "demo" | "supabase";
  getOverview(actor: Actor): Promise<Overview>;
  searchProperties(q: string): Promise<SearchResult[]>;
  getProperty(id: string, actor: Actor): Promise<PropertyDetail | null>;
  getComparableCandidates(propertyId: string, radiusM: number, sinceDate: string): Promise<ComparableCandidate[]>;
  getComparableOverrides(propertyId: string): Promise<Record<string, "include" | "exclude">>;
  setComparableOverride(propertyId: string, saleId: string, value: "include" | "exclude" | null, actor: Actor): Promise<void>;
  listAuctions(filter: { scope: "upcoming" | "all" }): Promise<AuctionListItem[]>;
  getAuction(id: string): Promise<AuctionDetail | null>;
  listSheriffOffices(): Promise<(SheriffOffice & { upcoming: number })[]>;
  getSheriffOffice(id: string): Promise<{ office: SheriffOffice; auctions: AuctionListItem[] } | null>;
  listIntegrations(): Promise<Integration[]>;
  listSchedules(): Promise<SyncScheduleRow[]>;
  updateSchedule(id: string, patch: { cron: string; enabled: boolean }, actor: Actor): Promise<void>;
  listJobs(limit: number): Promise<SyncJob[]>;
  getJob(id: string): Promise<{ job: SyncJob; events: SyncJobEvent[] } | null>;
  createJob(input: CreateSyncJobInput, actor: Actor): Promise<SyncJob>;
  cancelJob(id: string, actor: Actor): Promise<void>;
  listReviewQueue(): Promise<ReviewQueueItem[]>;
  listAuditLogs(actor: Actor, all: boolean): Promise<AuditLog[]>;
  writeAudit(actor: Actor, action: string, target: string | null, details?: Record<string, unknown>): Promise<void>;
  toggleWatchlist(propertyId: string, actor: Actor): Promise<boolean>;
  listUsers(): Promise<UserRow[]>;
}
