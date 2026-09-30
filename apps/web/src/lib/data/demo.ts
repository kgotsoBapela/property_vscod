import "server-only";
import {
  createFixtureAdapter,
  FIXTURE_AS_OF,
  haversineMeters,
  MemorySyncStore,
  nextCronRun,
  runSyncJob,
  suburbMarketSeries,
  type AuditLog,
  type ComparableCandidate,
  type CreateSyncJobInput,
  type Integration,
  type Property,
  type SyncJob,
} from "@propintel/shared";
import { rankProperties } from "./search";
import {
  ConflictError,
  type Actor,
  type AuctionListItem,
  type AuctionMatch,
  type DataRepository,
  type Overview,
  type SyncScheduleRow,
} from "./types";

/**
 * DEMO MODE repository: in-memory store populated by running the synthetic fixture provider through the
 * real sync pipeline at startup. Resets when the server restarts. Every record is flagged is_demo.
 */

const INTEGRATION_ID = "fixture";

const CANDIDATE_INTEGRATIONS: Omit<Integration, "last_success_at" | "last_failure_at" | "schedule_cron" | "schedule_timezone" | "schedule_enabled">[] = [
  { id: INTEGRATION_ID, provider_key: "fixture_demo", display_name: "Synthetic fixture provider (DEMO)", category: "fixture", status: "active", website: null, is_demo: true, capabilities: ["subject_property", "nearby_sales", "auctions", "provider_incremental", "full_reconciliation"], notes: "Deterministic synthetic data for development and demos." },
  { id: "lightstone", provider_key: "lightstone", display_name: "Lightstone", category: "property_data", status: "candidate", website: "https://portal.apis.lightstone.co.za/", is_demo: false, capabilities: [], notes: "Investigate deeds, transfers, comps, AVM and suburb APIs. Access, pricing and licensing unverified." },
  { id: "property24_data", provider_key: "property24_data", display_name: "Property24 Property Data", category: "property_data", status: "candidate", website: "https://www.property24.com/products/property-data", is_demo: false, capabilities: [], notes: "Programmatic access and reuse rights unconfirmed. No scraping." },
  { id: "windeed", provider_key: "windeed", display_name: "Lexis WinDeed", category: "property_data", status: "candidate", website: "https://www.windeed.co.za/", is_demo: false, capabilities: [], notes: "Programmatic access and retention rights unconfirmed." },
  { id: "deeds_registry", provider_key: "deeds_registry", display_name: "Deeds registry / authorised resellers", category: "property_data", status: "candidate", website: null, is_demo: false, capabilities: [], notes: "Evaluate official access channels." },
  { id: "aucor", provider_key: "aucor", display_name: "Aucor Property", category: "auctions", status: "candidate", website: "https://www.aucorproperty.co.za/", is_demo: false, capabilities: [], notes: "API/feed unconfirmed." },
  { id: "gemfinder", provider_key: "gemfinder", display_name: "GemFinder", category: "sheriff_notices", status: "candidate", website: "https://www.gemfinder.co.za/", is_demo: false, capabilities: [], notes: "Licensing and API/feed unconfirmed." },
  { id: "repolens", provider_key: "repolens", display_name: "RepoLens", category: "sheriff_notices", status: "candidate", website: "https://repolens.co.za/sheriff-auctions", is_demo: false, capabilities: [], notes: "Licensing and API/feed unconfirmed." },
  { id: "gpw_gazette", provider_key: "gpw_gazette", display_name: "Government Printing Works — Gazettes", category: "gazette", status: "candidate", website: "https://www.gpw.gov.za/Government-Gazettes/", is_demo: false, capabilities: [], notes: "Official notices; permitted ingestion and manual verification required." },
];

interface DemoState {
  store: MemorySyncStore;
  audit: AuditLog[];
  watchlists: Map<string, Set<string>>;
  overrides: Map<string, Record<string, "include" | "exclude">>;
  schedules: SyncScheduleRow[];
  lastSuccess: string | null;
  lastFailure: string | null;
  seq: number;
  ready: Promise<void>;
}

const globalForDemo = globalThis as unknown as { __propintelDemo?: DemoState };

function blankJob(scope: SyncJob["scope"], trigger: SyncJob["trigger"], requestedBy: string | null): Omit<SyncJob, "id"> {
  return {
    integration_id: INTEGRATION_ID,
    scope,
    target_property_id: null,
    params: {},
    status: "queued",
    trigger,
    requested_by: requestedBy,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    records_fetched: 0,
    records_upserted: 0,
    records_failed: 0,
    estimated_cost_zar: 0,
    error_category: null,
    error_message: null,
  };
}

function state(): DemoState {
  if (!globalForDemo.__propintelDemo) {
    const store = new MemorySyncStore();
    const s: DemoState = {
      store,
      audit: [],
      watchlists: new Map(),
      overrides: new Map(),
      schedules: [
        { id: "sched-incremental", integration_id: INTEGRATION_ID, scope: "provider_incremental", cron: "0 2 * * *", timezone: "Africa/Johannesburg", enabled: false, next_run_at: null },
        { id: "sched-auctions", integration_id: INTEGRATION_ID, scope: "auctions", cron: "0 6,18 * * *", timezone: "Africa/Johannesburg", enabled: false, next_run_at: null },
      ],
      lastSuccess: null,
      lastFailure: null,
      seq: 0,
      ready: Promise.resolve(),
    };
    s.ready = (async () => {
      const job = store.createJob(blankJob("full_reconciliation", "schedule", null));
      const r = await runSyncJob(job, createFixtureAdapter(), store, {});
      s.lastSuccess = r.status === "failed" ? null : new Date().toISOString();
    })();
    globalForDemo.__propintelDemo = s;
  }
  return globalForDemo.__propintelDemo;
}

async function ready() {
  const s = state();
  await s.ready;
  return s;
}

function identifiersFor(s: DemoState, id: string) {
  return s.store.identifiers.filter((i) => i.property_id === id);
}

function sheriffById(s: DemoState, id: string | null) {
  if (!id) return null;
  return [...s.store.sheriffOffices.values()].find((o) => o.id === id) ?? null;
}

function auctionListItem(s: DemoState, auctionId: string): AuctionListItem {
  const auction = [...s.store.auctions.values()].find((a) => a.id === auctionId)!;
  const sheriff = sheriffById(s, auction.sheriff_office_id);
  return {
    auction,
    sheriff: sheriff ? { id: sheriff.id, name: sheriff.name } : null,
    lots: s.store.auctionLinks
      .filter((l) => l.auction_id === auctionId)
      .map((l) => ({ described_address: l.described_address, property_id: l.property_id, review_status: l.review_status, candidate_count: l.candidate_property_ids.length })),
  };
}

function isUpcoming(eventAt: string | null, status: string) {
  return !!eventAt && new Date(eventAt).getTime() >= Date.now() - 86_400_000 && !["sold", "no_sale", "withdrawn"].includes(status);
}

export class DemoRepository implements DataRepository {
  readonly mode = "demo" as const;

  async getOverview(actor: Actor): Promise<Overview> {
    const s = await ready();
    const sales = [...s.store.sales.values()];
    const cutoff = new Date(Date.parse(FIXTURE_AS_OF) - 365 * 86_400_000).toISOString().slice(0, 10);
    const suburbs = [...new Set([...s.store.properties.values()].map((p) => p.suburb))].sort();
    const upcoming = [...s.store.auctions.values()]
      .filter((a) => isUpcoming(a.event_at, a.status))
      .sort((a, b) => (a.event_at ?? "").localeCompare(b.event_at ?? ""))
      .map((a) => auctionListItem(s, a.id));
    return {
      counts: {
        properties: s.store.properties.size,
        registered_sales: sales.filter((x) => x.verification_status === "verified" && x.registration_date).length,
        upcoming_auctions: upcoming.length,
        open_reviews: s.store.reviewQueue.filter((r) => r.status === "open").length,
        lots_needing_review: s.store.auctionLinks.filter((l) => l.review_status === "needs_review").length,
      },
      freshness: [
        {
          provider: "fixture_demo",
          display_name: "Synthetic fixture provider (DEMO)",
          is_demo: true,
          last_success_at: s.lastSuccess,
          last_failure_at: s.lastFailure,
          latest_record_at: [...s.store.sourceRecords.values()].reduce<string | null>((m, r) => (!m || r.retrieved_at > m ? r.retrieved_at : m), null),
        },
      ],
      upcoming: upcoming.slice(0, 5),
      watchlist: [...(s.watchlists.get(actor.id) ?? [])].map((id) => s.store.properties.get(id)).filter((p): p is Property => !!p),
      recent_jobs: [...s.store.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5),
      suburbs: suburbs.map((suburb) => {
        const recent = sales
          .filter((x) => x.registration_date && x.registration_date >= cutoff && x.is_arms_length && x.verification_status === "verified" && x.transfer_amount)
          .filter((x) => s.store.properties.get(x.property_id)?.suburb === suburb)
          .map((x) => x.transfer_amount!)
          .sort((a, b) => a - b);
        return { suburb, sales_12m: recent.length, median_12m: recent.length >= 3 ? recent[Math.floor(recent.length / 2)]! : null };
      }),
    };
  }

  async searchProperties(q: string) {
    const s = await ready();
    return rankProperties(q, s.store.properties.values(), (id) => identifiersFor(s, id));
  }

  async getProperty(id: string, actor: Actor) {
    const s = await ready();
    const property = s.store.properties.get(id);
    if (!property) return null;
    const sales = [...s.store.sales.values()].filter((x) => x.property_id === id);
    const valuations = [...s.store.valuations.values()].filter((v) => v.property_id === id).sort((a, b) => b.as_of_date.localeCompare(a.as_of_date));
    const auctions: AuctionMatch[] = s.store.auctionLinks
      .filter((l) => l.property_id === id || l.candidate_property_ids.includes(id))
      .map((l) => {
        const auction = [...s.store.auctions.values()].find((a) => a.id === l.auction_id)!;
        return {
          auction,
          lot_number: l.lot_number,
          described_address: l.described_address,
          review_status: l.review_status,
          match_confidence: l.match_confidence,
          match_evidence: l.match_evidence,
          sheriff_name: sheriffById(s, auction.sheriff_office_id)?.name ?? null,
        };
      });
    const sources = new Map<string, { provider: string; retrieved_at: string; is_demo: boolean }>();
    for (const x of [...sales, ...valuations]) {
      const prev = sources.get(x.provenance.provider);
      if (!prev || x.provenance.retrieved_at > prev.retrieved_at) sources.set(x.provenance.provider, { provider: x.provenance.provider, retrieved_at: x.provenance.retrieved_at, is_demo: x.provenance.is_demo });
    }
    if (sources.size === 0) sources.set("fixture_demo", { provider: "fixture_demo", retrieved_at: property.updated_at, is_demo: true });
    return {
      property,
      identifiers: identifiersFor(s, id),
      sales,
      valuations,
      auctions,
      market_series: suburbMarketSeries(property.suburb, property.property_type, s.store.properties, s.store.sales.values(), "2016-01-01"),
      sources: [...sources.values()],
      watchlisted: s.watchlists.get(actor.id)?.has(id) ?? false,
    };
  }

  async getComparableCandidates(propertyId: string, radiusM: number, sinceDate: string): Promise<ComparableCandidate[]> {
    const s = await ready();
    const subject = s.store.properties.get(propertyId);
    if (!subject || subject.latitude == null || subject.longitude == null) return [];
    const out: ComparableCandidate[] = [];
    for (const sale of s.store.sales.values()) {
      const p = s.store.properties.get(sale.property_id);
      if (!p || p.latitude == null || p.longitude == null) continue;
      const date = sale.registration_date ?? sale.sale_date;
      if (!date || date < sinceDate) continue;
      const d = haversineMeters(subject.latitude, subject.longitude, p.latitude, p.longitude);
      if (d <= radiusM) out.push({ sale, property: p, distance_m: d });
    }
    return out;
  }

  async getComparableOverrides(propertyId: string) {
    const s = await ready();
    return { ...(s.overrides.get(propertyId) ?? {}) };
  }

  async setComparableOverride(propertyId: string, saleId: string, value: "include" | "exclude" | null, actor: Actor) {
    const s = await ready();
    const o = { ...(s.overrides.get(propertyId) ?? {}) };
    if (value) o[saleId] = value;
    else delete o[saleId];
    s.overrides.set(propertyId, o);
    await this.writeAudit(actor, "comparable.override", propertyId, { sale_id: saleId, value });
  }

  async listAuctions(filter: { scope: "upcoming" | "all" }) {
    const s = await ready();
    return [...s.store.auctions.values()]
      .filter((a) => filter.scope === "all" || isUpcoming(a.event_at, a.status))
      .sort((a, b) => (a.event_at ?? "").localeCompare(b.event_at ?? ""))
      .map((a) => auctionListItem(s, a.id));
  }

  async getAuction(id: string) {
    const s = await ready();
    const auction = [...s.store.auctions.values()].find((a) => a.id === id);
    if (!auction) return null;
    const sheriff = sheriffById(s, auction.sheriff_office_id);
    return {
      auction,
      sheriff,
      documents: [...s.store.documents.values()].filter((d) => d.auction_id === id),
      lots: s.store.auctionLinks
        .filter((l) => l.auction_id === id)
        .map((l) => ({
          auction,
          lot_number: l.lot_number,
          described_address: l.described_address,
          review_status: l.review_status,
          match_confidence: l.match_confidence,
          match_evidence: l.match_evidence,
          sheriff_name: sheriff?.name ?? null,
          property: l.property_id ? s.store.properties.get(l.property_id) ?? null : null,
          candidates: l.candidate_property_ids.map((c) => s.store.properties.get(c)).filter((p): p is Property => !!p),
        })),
    };
  }

  async listSheriffOffices() {
    const s = await ready();
    return [...s.store.sheriffOffices.values()].map((o) => ({
      ...o,
      upcoming: [...s.store.auctions.values()].filter((a) => a.sheriff_office_id === o.id && isUpcoming(a.event_at, a.status)).length,
    }));
  }

  async getSheriffOffice(id: string) {
    const s = await ready();
    const office = sheriffById(s, id);
    if (!office) return null;
    return {
      office,
      auctions: [...s.store.auctions.values()].filter((a) => a.sheriff_office_id === id).map((a) => auctionListItem(s, a.id)),
    };
  }

  async listIntegrations(): Promise<Integration[]> {
    const s = await ready();
    const sched = s.schedules.find((x) => x.scope === "provider_incremental");
    return CANDIDATE_INTEGRATIONS.map((i) => ({
      ...i,
      last_success_at: i.id === INTEGRATION_ID ? s.lastSuccess : null,
      last_failure_at: i.id === INTEGRATION_ID ? s.lastFailure : null,
      schedule_cron: i.id === INTEGRATION_ID ? sched?.cron ?? null : null,
      schedule_timezone: "Africa/Johannesburg",
      schedule_enabled: i.id === INTEGRATION_ID ? sched?.enabled ?? false : false,
    }));
  }

  async listSchedules() {
    const s = await ready();
    return s.schedules.map((x) => ({ ...x, next_run_at: x.enabled ? nextCronRun(x.cron, x.timezone)?.toISOString() ?? null : null }));
  }

  async updateSchedule(id: string, patch: { cron: string; enabled: boolean }, actor: Actor) {
    const s = await ready();
    const sched = s.schedules.find((x) => x.id === id);
    if (!sched) throw new Error("Schedule not found");
    Object.assign(sched, patch);
    await this.writeAudit(actor, "schedule.update", id, patch);
  }

  async listJobs(limit: number) {
    const s = await ready();
    return [...s.store.jobs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
  }

  async getJob(id: string) {
    const s = await ready();
    const job = s.store.jobs.get(id);
    if (!job) return null;
    return { job, events: s.store.events.filter((e) => e.job_id === id) };
  }

  async createJob(input: CreateSyncJobInput, actor: Actor) {
    const s = await ready();
    if (input.integration_id !== INTEGRATION_ID) {
      throw new ConflictError("This integration has no verified adapter yet; only the synthetic fixture provider can be synced.");
    }
    const active = [...s.store.jobs.values()].find(
      (j) =>
        j.integration_id === input.integration_id &&
        j.scope === input.scope &&
        (j.target_property_id ?? null) === (input.target_property_id ?? null) &&
        ["queued", "running", "cancellation_requested"].includes(j.status),
    );
    if (active) throw new ConflictError(`A ${input.scope} job for this target is already ${active.status} (${active.id}).`);

    const job = s.store.createJob({
      ...blankJob(input.scope, "manual", actor.id),
      target_property_id: input.target_property_id,
      params: input.params,
    });
    await this.writeAudit(actor, "sync.trigger", job.id, { scope: input.scope, target: input.target_property_id, params: input.params });

    const subjectProp = input.target_property_id ? s.store.properties.get(input.target_property_id) : undefined;
    const legal = subjectProp
      ? identifiersFor(s, subjectProp.id).find((i) => i.kind === "sectional_scheme_unit") ?? identifiersFor(s, subjectProp.id).find((i) => i.kind === "erf")
      : undefined;
    const subject = subjectProp
      ? {
          address: subjectProp.normalized_address,
          erf_number: legal?.erf_number ?? null,
          portion: legal?.portion ?? null,
          township: legal?.township ?? null,
          scheme_name: legal?.scheme_name ?? null,
          scheme_number: legal?.scheme_number ?? null,
          unit_number: legal?.unit_number ?? null,
          latitude: subjectProp.latitude,
          longitude: subjectProp.longitude,
        }
      : undefined;

    // Return the job id immediately; the run proceeds in the background (the worker does this in production).
    setTimeout(() => {
      void runSyncJob(job, createFixtureAdapter({ latencyMs: 700 }), s.store, { subject, radius_m: input.params.radius_m ?? 1500 }, {
        retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 1500, timeoutMs: 10_000 },
      }).then((r) => {
        if (r.status === "failed") s.lastFailure = new Date().toISOString();
        else if (r.status !== "cancelled") s.lastSuccess = new Date().toISOString();
      });
    }, 250);
    return job;
  }

  async cancelJob(id: string, actor: Actor) {
    const s = await ready();
    const job = s.store.jobs.get(id);
    if (!job) throw new Error("Job not found");
    if (job.status === "queued") await s.store.updateJob(id, { status: "cancelled", finished_at: new Date().toISOString() });
    else if (job.status === "running") await s.store.updateJob(id, { status: "cancellation_requested" });
    else throw new ConflictError(`Job is already ${job.status}`);
    await this.writeAudit(actor, "sync.cancel", id);
  }

  async listReviewQueue() {
    const s = await ready();
    const items = s.store.reviewQueue.filter((r) => r.status === "open").map((r) => ({ ...r }));
    // Ambiguous auction lots are review items too.
    for (const l of s.store.auctionLinks.filter((x) => x.review_status === "needs_review")) {
      const a = [...s.store.auctions.entries()].find(([, v]) => v.id === l.auction_id);
      items.push({
        id: `lot-${l.auction_id}-${l.lot_number}`,
        created_at: a?.[1].provenance.retrieved_at ?? "",
        provider: a?.[1].provenance.provider ?? "",
        external_id: a?.[0].split(":")[1] ?? "",
        description: `Auction lot: ${l.described_address}`,
        reason: l.match_evidence[0] ?? "Needs review",
        candidates: l.candidate_property_ids.map((pid) => ({ property_id: pid, confidence: l.match_confidence, evidence: l.match_evidence.slice(1), conflicts: [] })),
        status: "open" as const,
      });
    }
    return items;
  }

  async listAuditLogs(actor: Actor, all: boolean) {
    const s = await ready();
    return s.audit.filter((a) => all || a.actor_id === actor.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 200);
  }

  async writeAudit(actor: Actor, action: string, target: string | null, details?: Record<string, unknown>) {
    const s = state();
    s.audit.push({ id: String(++s.seq), at: new Date().toISOString(), actor_id: actor.id, actor_label: actor.label, action, target, details: details ?? null });
  }

  async toggleWatchlist(propertyId: string, actor: Actor) {
    const s = await ready();
    const set = s.watchlists.get(actor.id) ?? new Set<string>();
    const on = !set.has(propertyId);
    if (on) set.add(propertyId);
    else set.delete(propertyId);
    s.watchlists.set(actor.id, set);
    return on;
  }

  async listUsers() {
    return [
      { id: "demo-super_admin", email: "demo super admin (no real account)", role: "super_admin" as const, created_at: FIXTURE_AS_OF },
      { id: "demo-admin", email: "demo admin (no real account)", role: "admin" as const, created_at: FIXTURE_AS_OF },
      { id: "demo-viewer", email: "demo viewer (no real account)", role: "viewer" as const, created_at: FIXTURE_AS_OF },
    ];
  }
}
