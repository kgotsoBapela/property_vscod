import { haversineMeters } from "../analysis/geo";
import { streetAddressKey } from "../matching/address";
import type { CanonicalCandidate, IdentityFacts } from "../matching/identity";
import type {
  Auction,
  AuctionDocument,
  AuctionPropertyLink,
  Property,
  PropertyIdentifier,
  PropertySale,
  PropertyValuation,
  Provenance,
  SheriffOffice,
  SyncJob,
  SyncJobEvent,
} from "../types/domain";
import type { CommitItem, PropertyResolution, SyncStore } from "./pipeline";

export interface StoredSourceRecord {
  id: string;
  provider: string;
  external_id: string;
  content_hash: string;
  raw: unknown | null;
  first_retrieved_at: string;
  retrieved_at: string;
  retention_until: string | null;
  is_demo: boolean;
}

export interface ReviewItem {
  id: string;
  created_at: string;
  provider: string;
  external_id: string;
  description: string;
  candidates: NonNullable<PropertyResolution["review"]>["candidates"];
  reason: string;
  status: "open" | "resolved";
}

export interface AuctionLinkRow extends AuctionPropertyLink {
  candidate_property_ids: string[];
}

/** Deterministic UUID-shaped ids so demo URLs are stable across restarts. */
function idFactory(prefix: number) {
  let n = 0;
  return () => `00000000-0000-4000-${(0x8000 + prefix).toString(16)}-${(++n).toString(16).padStart(12, "0")}`;
}

/**
 * In-memory implementation of the canonical store. Used by demo mode (no Supabase configured) and tests.
 * Each commitItem builds its changes first and applies them in one synchronous step, so a thrown error
 * leaves the store unchanged (the in-memory analogue of a database transaction).
 */
export class MemorySyncStore implements SyncStore {
  properties = new Map<string, Property>();
  identifiers: PropertyIdentifier[] = [];
  sales = new Map<string, PropertySale>();
  valuations = new Map<string, PropertyValuation>();
  auctions = new Map<string, Auction>();
  auctionLinks: AuctionLinkRow[] = [];
  documents = new Map<string, AuctionDocument>();
  sheriffOffices = new Map<string, SheriffOffice>();
  sourceRecords = new Map<string, StoredSourceRecord>();
  reviewQueue: ReviewItem[] = [];
  checkpoints = new Map<string, string | null>();
  jobs = new Map<string, SyncJob>();
  events: SyncJobEvent[] = [];
  /** Test hook: throw inside commitItem for a given external id. */
  failCommitFor: string | null = null;

  private nextPropertyId = idFactory(1);
  private nextId = idFactory(2);
  private externalToCanonical = new Map<string, string>(); // "provider:ext" -> canonical id

  private key(provider: string, externalId: string) {
    return `${provider}:${externalId}`;
  }

  async getCheckpoint(integrationId: string, scopeKey: string) {
    return this.checkpoints.get(`${integrationId}:${scopeKey}`) ?? null;
  }

  async saveCheckpoint(integrationId: string, scopeKey: string, cursor: string | null) {
    this.checkpoints.set(`${integrationId}:${scopeKey}`, cursor);
  }

  async getSourceHash(provider: string, externalId: string) {
    return this.sourceRecords.get(this.key(provider, externalId))?.content_hash ?? null;
  }

  factsFor(p: Property): CanonicalCandidate {
    const ids = this.identifiers.filter((i) => i.property_id === p.id);
    const legal = ids.find((i) => i.kind === "sectional_scheme_unit") ?? ids.find((i) => i.kind === "erf");
    return {
      property_id: p.id,
      address: streetAddressKey(p.street_number, p.street_name, p.suburb) ?? p.normalized_address,
      erf_number: legal?.erf_number ?? null,
      portion: legal?.portion ?? null,
      township: legal?.township ?? null,
      scheme_name: legal?.scheme_name ?? null,
      scheme_number: legal?.scheme_number ?? null,
      unit_number: legal?.unit_number ?? null,
      latitude: p.latitude,
      longitude: p.longitude,
      provider_ids: ids
        .filter((i) => i.kind === "provider_property_id" && i.provider && i.external_id)
        .map((i) => ({ provider: i.provider!, external_id: i.external_id! })),
    };
  }

  async findCandidates(facts: IdentityFacts): Promise<CanonicalCandidate[]> {
    const out: CanonicalCandidate[] = [];
    const lower = (v: string | null) => v?.toLowerCase() ?? null;
    for (const p of this.properties.values()) {
      const c = this.factsFor(p);
      const related =
        facts.provider_ids.some((f) => c.provider_ids.some((x) => x.provider === f.provider && x.external_id === f.external_id)) ||
        (facts.erf_number && lower(facts.erf_number) === lower(c.erf_number)) ||
        (facts.scheme_number && lower(facts.scheme_number) === lower(c.scheme_number)) ||
        (facts.scheme_name && lower(facts.scheme_name) === lower(c.scheme_name)) ||
        (facts.address && c.address && streetKeyOf(facts.address) === streetKeyOf(c.address)) ||
        (facts.latitude != null && facts.longitude != null && c.latitude != null && c.longitude != null &&
          haversineMeters(facts.latitude, facts.longitude, c.latitude, c.longitude) <= 50);
      if (related) out.push(c);
    }
    return out;
  }

  async commitItem(item: CommitItem): Promise<{ property_id: string | null }> {
    if (this.failCommitFor && item.source.external_id === this.failCommitFor) {
      throw new Error(`Simulated storage failure for ${item.source.external_id}`);
    }
    const srcKey = this.key(item.source.provider, item.source.external_id);
    const existingSrc = this.sourceRecords.get(srcKey);
    const source: StoredSourceRecord = {
      id: existingSrc?.id ?? this.nextId(),
      ...item.source,
      first_retrieved_at: existingSrc?.first_retrieved_at ?? item.source.retrieved_at,
    };
    const provenance: Provenance = {
      provider: item.source.provider,
      source_record_id: source.id,
      retrieved_at: item.source.retrieved_at,
      is_demo: item.source.is_demo,
    };

    if (item.kind === "unchanged") {
      this.sourceRecords.set(srcKey, source);
      this.touchProvenance(source.id, item.source.retrieved_at);
      return { property_id: this.externalToCanonical.get(srcKey) ?? null };
    }

    if (item.kind === "property") {
      const r = item.record;
      if (item.resolution.review) {
        // Ambiguous: keep the source record, queue for a human, do not merge or create.
        this.sourceRecords.set(srcKey, source);
        const existing = this.reviewQueue.find((q) => q.provider === item.source.provider && q.external_id === r.external_id && q.status === "open");
        if (!existing) {
          this.reviewQueue.push({
            id: this.nextId(),
            created_at: item.source.retrieved_at,
            provider: item.source.provider,
            external_id: r.external_id,
            description: r.address,
            candidates: item.resolution.review.candidates,
            reason: item.resolution.review.reason,
            status: "open",
          });
        }
        return { property_id: null };
      }

      const propertyId = item.resolution.property_id ?? this.externalToCanonical.get(srcKey) ?? this.nextPropertyId();
      const property: Property = {
        id: propertyId,
        normalized_address: r.address,
        street_number: r.street_number,
        street_name: r.street_name,
        unit_number: r.unit_number,
        complex_name: r.complex_name,
        suburb: r.suburb,
        municipality: r.municipality,
        province: r.province,
        postal_code: r.postal_code,
        latitude: r.latitude,
        longitude: r.longitude,
        property_type: r.property_type,
        erf_size_m2: r.erf_size_m2,
        floor_size_m2: r.floor_size_m2,
        bedrooms: r.bedrooms,
        bathrooms: r.bathrooms,
        is_demo: item.source.is_demo,
        updated_at: item.source.retrieved_at,
      };

      const newIdentifiers: PropertyIdentifier[] = [
        {
          id: this.nextId(),
          property_id: propertyId,
          kind: "provider_property_id",
          erf_number: null, portion: null, township: null, scheme_name: null, scheme_number: null, unit_number: null, title_deed: null,
          provider: item.source.provider,
          external_id: r.external_id,
          verification_status: "verified",
          provenance,
        },
      ];
      if (r.scheme_name || r.scheme_number) {
        newIdentifiers.push({
          id: this.nextId(), property_id: propertyId, kind: "sectional_scheme_unit",
          erf_number: r.erf_number, portion: r.portion, township: r.township,
          scheme_name: r.scheme_name, scheme_number: r.scheme_number, unit_number: r.unit_number, title_deed: r.title_deed,
          provider: item.source.provider, external_id: null,
          verification_status: r.identifiers_verified ? "verified" : "unverified", provenance,
        });
      } else if (r.erf_number) {
        newIdentifiers.push({
          id: this.nextId(), property_id: propertyId, kind: "erf",
          erf_number: r.erf_number, portion: r.portion, township: r.township,
          scheme_name: null, scheme_number: null, unit_number: null, title_deed: r.title_deed,
          provider: item.source.provider, external_id: null,
          verification_status: r.identifiers_verified ? "verified" : "unverified", provenance,
        });
      }

      const sales = r.sales.map<PropertySale>((s) => ({
        id: this.sales.get(this.key(item.source.provider, s.external_id))?.id ?? this.nextId(),
        property_id: propertyId,
        transfer_amount: s.transfer_amount,
        sale_date: s.sale_date,
        registration_date: s.registration_date,
        transfer_type: s.transfer_type,
        is_arms_length: s.is_arms_length,
        title_deed: s.title_deed,
        verification_status: s.verification_status,
        provenance,
      }));
      const valuations = r.valuations.map<PropertyValuation>((v) => ({
        id: this.valuations.get(this.key(item.source.provider, v.external_id))?.id ?? this.nextId(),
        property_id: propertyId,
        provider: item.source.provider,
        model: v.model,
        methodology_version: v.methodology_version,
        point_estimate: v.point_estimate,
        range_low: v.range_low,
        range_high: v.range_high,
        as_of_date: v.as_of_date,
        confidence: v.confidence,
        confidence_notes: v.confidence_notes,
        provenance,
      }));

      // Apply (no awaits, no throws past this point)
      this.sourceRecords.set(srcKey, source);
      this.externalToCanonical.set(srcKey, propertyId);
      this.properties.set(propertyId, property);
      this.identifiers = this.identifiers.filter(
        (i) => !(i.property_id === propertyId && i.provider === item.source.provider),
      );
      this.identifiers.push(...newIdentifiers);
      r.sales.forEach((s, i) => this.sales.set(this.key(item.source.provider, s.external_id), sales[i]!));
      r.valuations.forEach((v, i) => this.valuations.set(this.key(item.source.provider, v.external_id), valuations[i]!));
      return { property_id: propertyId };
    }

    // Auction
    const r = item.record;
    const auctionKey = this.key(item.source.provider, r.external_id);
    const prev = this.auctions.get(auctionKey);
    let sheriff: SheriffOffice | null = null;
    if (r.sheriff_office) {
      const sk = this.key(item.source.provider, r.sheriff_office.external_id);
      sheriff = {
        id: this.sheriffOffices.get(sk)?.id ?? this.nextId(),
        name: r.sheriff_office.name,
        jurisdiction: r.sheriff_office.jurisdiction,
        province: r.sheriff_office.province,
        physical_address: r.sheriff_office.physical_address,
        phone: r.sheriff_office.phone,
        email: r.sheriff_office.email,
        contact_verified_at: r.sheriff_office.contact_verified_at,
        verification_status: r.sheriff_office.contact_verified_at ? "verified" : "unverified",
        source_url: r.sheriff_office.source_url,
        provenance,
      };
    }
    const statusChanged = !prev || prev.status !== r.status;
    const auction: Auction = {
      id: prev?.id ?? this.nextId(),
      kind: r.kind,
      auction_house_id: r.auction_house?.external_id ?? null,
      auction_house_name: r.auction_house?.name ?? null,
      sheriff_office_id: sheriff?.id ?? null,
      title: r.title,
      event_at: r.event_at,
      venue: r.venue,
      status: r.status,
      status_history: statusChanged
        ? [...(prev?.status_history ?? []), { status: r.status, at: item.source.retrieved_at, note: r.status_note }]
        : prev!.status_history,
      prices: r.prices,
      deposit_terms: r.deposit_terms,
      conditions_summary: r.conditions_summary,
      case_reference: r.case_reference,
      notice_url: r.notice_url,
      last_verified_at: r.verified_at,
      verification_status: r.verified_at ? "verified" : "unverified",
      provenance,
    };
    const links: AuctionLinkRow[] = item.lots.map((l) => {
      const lot = r.lots[l.lot_index]!;
      return {
        auction_id: auction.id,
        property_id: l.property_id,
        candidate_property_ids: l.candidate_property_ids,
        lot_number: lot.lot_number,
        described_address: lot.described_address,
        described_erf: lot.erf_number,
        match_confidence: l.confidence,
        match_evidence: l.evidence,
        review_status: l.review_status,
      };
    });
    const docs = r.documents.map<AuctionDocument>((d) => ({
      id: this.documents.get(this.key(item.source.provider, d.external_id))?.id ?? this.nextId(),
      auction_id: auction.id,
      kind: d.kind,
      title: d.title,
      url: d.url,
      storage_path: null,
      published_at: d.published_at,
      provenance,
    }));

    this.sourceRecords.set(srcKey, source);
    if (sheriff && r.sheriff_office) this.sheriffOffices.set(this.key(item.source.provider, r.sheriff_office.external_id), sheriff);
    this.auctions.set(auctionKey, auction);
    this.auctionLinks = this.auctionLinks.filter((l) => l.auction_id !== auction.id).concat(links);
    r.documents.forEach((d, i) => this.documents.set(this.key(item.source.provider, d.external_id), docs[i]!));
    return { property_id: null };
  }

  private touchProvenance(sourceRecordId: string, at: string) {
    const bump = <T extends { provenance: Provenance }>(m: Map<string, T>) => {
      for (const v of m.values()) if (v.provenance.source_record_id === sourceRecordId) v.provenance = { ...v.provenance, retrieved_at: at };
    };
    bump(this.sales);
    bump(this.valuations);
    bump(this.auctions);
  }

  async appendEvent(jobId: string, level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
    this.events.push({ id: this.nextId(), job_id: jobId, at: new Date().toISOString(), level, message, data: data ?? null });
  }

  async updateJob(jobId: string, patch: Partial<SyncJob>) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    // A cancellation request must not be overwritten by a progress update.
    if (job.status === "cancellation_requested" && patch.status === "running") patch = { ...patch, status: job.status };
    this.jobs.set(jobId, { ...job, ...patch });
  }

  async isCancellationRequested(jobId: string) {
    return this.jobs.get(jobId)?.status === "cancellation_requested";
  }

  createJob(job: Omit<SyncJob, "id">): SyncJob {
    const created = { ...job, id: this.nextId() };
    this.jobs.set(created.id, created);
    return created;
  }

  /** Snapshot used by tests to assert that a failed run leaves prior data untouched. */
  snapshot() {
    return JSON.stringify({
      p: [...this.properties.values()].map((p) => ({ ...p, updated_at: undefined })),
      s: [...this.sales.values()].map((s) => ({ ...s, provenance: undefined })),
      v: [...this.valuations.values()].map((v) => ({ ...v, provenance: undefined })),
    });
  }
}

function streetKeyOf(address: string) {
  return address.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
}
