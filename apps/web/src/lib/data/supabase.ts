import "server-only";
import {
  parseSearchQuery,
  suburbMarketSeries,
  type Auction,
  type AuctionDocument,
  type AuditLog,
  type ComparableCandidate,
  type CreateSyncJobInput,
  type Integration,
  type Property,
  type PropertyIdentifier,
  type PropertySale,
  type PropertyValuation,
  type Provenance,
  type SheriffOffice,
  type SyncJob,
  type SyncJobEvent,
} from "@propintel/shared";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { rankProperties } from "./search";
import {
  ConflictError,
  type Actor,
  type AuctionListItem,
  type AuctionMatch,
  type DataRepository,
  type Overview,
  type ReviewQueueItem,
  type SyncScheduleRow,
  type UserRow,
} from "./types";

type Row = Record<string, unknown>;

function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    if (res.error.code === "23505") throw new ConflictError("An active job already exists for this integration, scope and target.");
    throw new Error(res.error.message);
  }
  return res.data as T;
}

const num = (v: unknown) => (v == null ? null : Number(v));

function provenance(r: Row): Provenance {
  return {
    provider: String(r.provider ?? "unknown"),
    source_record_id: (r.source_record_id as string) ?? null,
    retrieved_at: String(r.retrieved_at ?? ""),
    is_demo: Boolean(r.is_demo),
  };
}

function toProperty(r: Row): Property {
  return {
    ...(r as unknown as Property),
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    erf_size_m2: num(r.erf_size_m2),
    floor_size_m2: num(r.floor_size_m2),
    bedrooms: num(r.bedrooms),
    bathrooms: num(r.bathrooms),
  };
}

function toSale(r: Row): PropertySale {
  return { ...(r as unknown as PropertySale), transfer_amount: num(r.transfer_amount), provenance: provenance(r) };
}

function toValuation(r: Row): PropertyValuation {
  return {
    ...(r as unknown as PropertyValuation),
    point_estimate: num(r.point_estimate),
    range_low: num(r.range_low),
    range_high: num(r.range_high),
    provenance: provenance(r),
  };
}

function toIdentifier(r: Row): PropertyIdentifier {
  return { ...(r as unknown as PropertyIdentifier), provenance: provenance(r) };
}

function toAuction(r: Row): Auction {
  const house = r.auction_houses as Row | null | undefined;
  return {
    ...(r as unknown as Auction),
    auction_house_name: (house?.name as string) ?? null,
    provenance: provenance(r),
  };
}

function toSheriff(r: Row): SheriffOffice {
  return { ...(r as unknown as SheriffOffice), provenance: provenance(r) };
}

const AUCTION_SELECT = "*, auction_houses(name), sheriff_offices(id, name), auction_properties(described_address, property_id, review_status, candidate_property_ids)";

function toListItem(r: Row): AuctionListItem {
  const sheriff = r.sheriff_offices as Row | null;
  return {
    auction: toAuction(r),
    sheriff: sheriff ? { id: String(sheriff.id), name: String(sheriff.name) } : null,
    lots: ((r.auction_properties as Row[]) ?? []).map((l) => ({
      described_address: String(l.described_address),
      property_id: (l.property_id as string) ?? null,
      review_status: String(l.review_status),
      candidate_count: ((l.candidate_property_ids as string[]) ?? []).length,
    })),
  };
}

export class SupabaseRepository implements DataRepository {
  readonly mode = "supabase" as const;
  private db = createSupabaseServerClient();

  async getOverview(actor: Actor): Promise<Overview> {
    const db = await this.db;
    const nowIso = new Date(Date.now() - 86_400_000).toISOString();
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const [props, sales, upcoming, reviews, lots, freshness, watch, jobs, recentSales] = await Promise.all([
      db.from("properties").select("id", { count: "exact", head: true }),
      db.from("property_sales").select("id", { count: "exact", head: true }).eq("verification_status", "verified").not("registration_date", "is", null),
      db.from("auctions").select(AUCTION_SELECT).gte("event_at", nowIso).in("status", ["scheduled", "postponed", "cancelled", "unknown"]).order("event_at").limit(5),
      db.from("identity_review_queue").select("id", { count: "exact", head: true }).eq("status", "open"),
      db.from("auction_properties").select("id", { count: "exact", head: true }).eq("review_status", "needs_review"),
      db.from("v_data_freshness").select("*"),
      db.from("property_watchlists").select("properties(*)").eq("user_id", actor.id),
      db.from("sync_jobs").select("*").order("created_at", { ascending: false }).limit(5),
      db.from("property_sales").select("transfer_amount, properties!inner(suburb)").gte("registration_date", yearAgo).eq("is_arms_length", true).eq("verification_status", "verified").not("transfer_amount", "is", null).limit(5000),
    ]);
    const bySuburb = new Map<string, number[]>();
    for (const r of (recentSales.data ?? []) as Row[]) {
      const suburb = String((r.properties as Row).suburb);
      bySuburb.set(suburb, [...(bySuburb.get(suburb) ?? []), Number(r.transfer_amount)]);
    }
    return {
      counts: {
        properties: props.count ?? 0,
        registered_sales: sales.count ?? 0,
        upcoming_auctions: (upcoming.data ?? []).length,
        open_reviews: reviews.count ?? 0,
        lots_needing_review: lots.count ?? 0,
      },
      freshness: ((freshness.data ?? []) as Row[]).map((f) => ({
        provider: String(f.integration_id),
        display_name: String(f.display_name),
        is_demo: Boolean(f.is_demo),
        last_success_at: (f.last_success_at as string) ?? null,
        last_failure_at: (f.last_failure_at as string) ?? null,
        latest_record_at: (f.latest_record_at as string) ?? null,
      })),
      upcoming: ((upcoming.data ?? []) as Row[]).map(toListItem),
      watchlist: ((watch.data ?? []) as Row[]).map((w) => toProperty(w.properties as Row)),
      recent_jobs: (jobs.data ?? []) as SyncJob[],
      suburbs: [...bySuburb.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([suburb, prices]) => {
          const sorted = prices.sort((a, b) => a - b);
          return { suburb, sales_12m: sorted.length, median_12m: sorted.length >= 3 ? sorted[Math.floor(sorted.length / 2)]! : null };
        }),
    };
  }

  async searchProperties(q: string) {
    const db = await this.db;
    const parsed = parseSearchQuery(q);
    let ids: string[] | null = null;
    if (parsed.erf_number || parsed.scheme_number) {
      let iq = db.from("property_identifiers").select("property_id").in("kind", ["erf", "sectional_scheme_unit"]);
      if (parsed.erf_number) iq = iq.eq("erf_number", parsed.erf_number);
      if (parsed.scheme_number) iq = iq.ilike("scheme_number", `%${parsed.scheme_number}%`);
      ids = [...new Set((must(await iq.limit(500)) as Row[]).map((r) => String(r.property_id)))];
      if (ids.length === 0) return [];
    }
    let pq = db.from("properties").select("*");
    if (ids) pq = pq.in("id", ids);
    else {
      const tokens = parsed.normalized.split(" ").filter((t) => t.length > 1).slice(0, 6);
      for (const t of tokens) pq = pq.ilike("search_text", `%${t.replace(/[%_]/g, "")}%`);
    }
    const props = (must(await pq.limit(200)) as Row[]).map(toProperty);
    if (props.length === 0) return [];
    const idents = (must(await db.from("property_identifiers").select("*").in("property_id", props.map((p) => p.id))) as Row[]).map(toIdentifier);
    return rankProperties(q, props, (id) => idents.filter((i) => i.property_id === id));
  }

  async getProperty(id: string, actor: Actor) {
    const db = await this.db;
    const { data: row } = await db.from("properties").select("*").eq("id", id).maybeSingle();
    if (!row) return null;
    const property = toProperty(row);
    const [idents, sales, vals, links, watch, market] = await Promise.all([
      db.from("property_identifiers").select("*").eq("property_id", id),
      db.from("property_sales").select("*").eq("property_id", id),
      db.from("property_valuations").select("*").eq("property_id", id).order("as_of_date", { ascending: false }),
      db.from("auction_properties").select(`*, auctions(${AUCTION_SELECT})`).or(`property_id.eq.${id},candidate_property_ids.cs.{${id}}`),
      db.from("property_watchlists").select("id").eq("user_id", actor.id).eq("property_id", id).maybeSingle(),
      db
        .from("property_sales")
        .select("*, properties!inner(id, suburb, property_type, floor_size_m2)")
        .eq("properties.suburb", property.suburb)
        .eq("properties.property_type", property.property_type)
        .gte("registration_date", "2016-01-01")
        .limit(5000),
    ]);
    const saleRows = (must(sales) as Row[]).map(toSale);
    const valuations = (must(vals) as Row[]).map(toValuation);
    const marketRows = (must(market) as Row[]) ?? [];
    const marketProps = new Map<string, Property>();
    for (const r of marketRows) {
      const p = r.properties as Row;
      marketProps.set(String(p.id), { ...property, id: String(p.id), suburb: String(p.suburb), property_type: p.property_type as Property["property_type"], floor_size_m2: num(p.floor_size_m2) });
    }
    const auctions: AuctionMatch[] = ((must(links) as Row[]) ?? []).map((l) => {
      const a = l.auctions as Row;
      return {
        auction: toAuction(a),
        lot_number: (l.lot_number as string) ?? null,
        described_address: String(l.described_address),
        review_status: l.review_status as AuctionMatch["review_status"],
        match_confidence: Number(l.match_confidence),
        match_evidence: (l.match_evidence as string[]) ?? [],
        sheriff_name: ((a.sheriff_offices as Row | null)?.name as string) ?? null,
      };
    });
    const sources = new Map<string, { provider: string; retrieved_at: string; is_demo: boolean }>();
    for (const x of [...saleRows, ...valuations]) {
      const prev = sources.get(x.provenance.provider);
      if (!prev || x.provenance.retrieved_at > prev.retrieved_at) sources.set(x.provenance.provider, { ...x.provenance });
    }
    return {
      property,
      identifiers: (must(idents) as Row[]).map(toIdentifier),
      sales: saleRows,
      valuations,
      auctions,
      market_series: suburbMarketSeries(property.suburb, property.property_type, marketProps, marketRows.map(toSale), "2016-01-01"),
      sources: [...sources.values()],
      watchlisted: Boolean(watch.data),
    };
  }

  async getComparableCandidates(propertyId: string, radiusM: number, sinceDate: string): Promise<ComparableCandidate[]> {
    const db = await this.db;
    const rows = must(await db.rpc("nearby_sales", { p_property_id: propertyId, p_radius_m: radiusM, p_since: sinceDate })) as Row[];
    return rows.map((r) => ({ sale: toSale(r.sale as Row), property: toProperty(r.property as Row), distance_m: Number(r.distance_m) }));
  }

  async getComparableOverrides(propertyId: string) {
    const db = await this.db;
    const rows = must(await db.from("comparable_sales").select("sale_id, analyst_override").eq("target_property_id", propertyId)) as Row[];
    return Object.fromEntries(rows.filter((r) => r.analyst_override).map((r) => [String(r.sale_id), r.analyst_override as "include" | "exclude"]));
  }

  async setComparableOverride(propertyId: string, saleId: string, value: "include" | "exclude" | null, actor: Actor) {
    const db = await this.db;
    must(
      await db
        .from("comparable_sales")
        .upsert({ target_property_id: propertyId, sale_id: saleId, analyst_override: value, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: "target_property_id,sale_id" }),
    );
    await this.writeAudit(actor, "comparable.override", propertyId, { sale_id: saleId, value });
  }

  async listAuctions(filter: { scope: "upcoming" | "all" }) {
    const db = await this.db;
    let q = db.from("auctions").select(AUCTION_SELECT).order("event_at", { ascending: true });
    if (filter.scope === "upcoming") q = q.gte("event_at", new Date(Date.now() - 86_400_000).toISOString()).not("status", "in", "(sold,no_sale,withdrawn)");
    return (must(await q.limit(500)) as Row[]).map(toListItem);
  }

  async getAuction(id: string) {
    const db = await this.db;
    const { data: a } = await db.from("auctions").select("*, auction_houses(name)").eq("id", id).maybeSingle();
    if (!a) return null;
    const auction = toAuction(a);
    const [sheriff, docs, lots] = await Promise.all([
      auction.sheriff_office_id ? db.from("sheriff_offices").select("*").eq("id", auction.sheriff_office_id).maybeSingle() : Promise.resolve({ data: null }),
      db.from("auction_documents").select("*").eq("auction_id", id),
      db.from("auction_properties").select("*, properties(*)").eq("auction_id", id).order("lot_index"),
    ]);
    const lotRows = (must(lots) as Row[]) ?? [];
    const candidateIds = [...new Set(lotRows.flatMap((l) => (l.candidate_property_ids as string[]) ?? []))];
    const candidates = candidateIds.length
      ? ((must(await db.from("properties").select("*").in("id", candidateIds)) as Row[]) ?? []).map(toProperty)
      : [];
    const office = sheriff.data ? toSheriff(sheriff.data as Row) : null;
    return {
      auction,
      sheriff: office,
      documents: ((must(docs) as Row[]) ?? []).map((d) => ({ ...(d as unknown as AuctionDocument), provenance: provenance(d) })),
      lots: lotRows.map((l) => ({
        auction,
        lot_number: (l.lot_number as string) ?? null,
        described_address: String(l.described_address),
        review_status: l.review_status as AuctionMatch["review_status"],
        match_confidence: Number(l.match_confidence),
        match_evidence: (l.match_evidence as string[]) ?? [],
        sheriff_name: office?.name ?? null,
        property: l.properties ? toProperty(l.properties as Row) : null,
        candidates: candidates.filter((c) => ((l.candidate_property_ids as string[]) ?? []).includes(c.id)),
      })),
    };
  }

  async listSheriffOffices() {
    const db = await this.db;
    const [offices, auctions] = await Promise.all([
      db.from("sheriff_offices").select("*").order("name"),
      db.from("auctions").select("sheriff_office_id").gte("event_at", new Date().toISOString()).not("sheriff_office_id", "is", null),
    ]);
    const counts = new Map<string, number>();
    for (const a of (auctions.data ?? []) as Row[]) counts.set(String(a.sheriff_office_id), (counts.get(String(a.sheriff_office_id)) ?? 0) + 1);
    return ((must(offices) as Row[]) ?? []).map((o) => ({ ...toSheriff(o), upcoming: counts.get(String(o.id)) ?? 0 }));
  }

  async getSheriffOffice(id: string) {
    const db = await this.db;
    const { data: o } = await db.from("sheriff_offices").select("*").eq("id", id).maybeSingle();
    if (!o) return null;
    const auctions = (must(await db.from("auctions").select(AUCTION_SELECT).eq("sheriff_office_id", id).order("event_at")) as Row[]).map(toListItem);
    return { office: toSheriff(o), auctions };
  }

  async listIntegrations(): Promise<Integration[]> {
    const db = await this.db;
    const [ints, caps, scheds] = await Promise.all([
      db.from("integrations").select("*").order("is_demo", { ascending: false }).order("display_name"),
      db.from("integration_capabilities").select("*"),
      db.from("sync_schedules").select("*").eq("scope", "provider_incremental"),
    ]);
    return ((must(ints) as Row[]) ?? []).map((i) => {
      const s = ((scheds.data ?? []) as Row[]).find((x) => x.integration_id === i.id);
      return {
        ...(i as unknown as Integration),
        capabilities: ((caps.data ?? []) as Row[]).filter((c) => c.integration_id === i.id).map((c) => String(c.capability)),
        schedule_cron: (s?.cron as string) ?? null,
        schedule_timezone: (s?.timezone as string) ?? "Africa/Johannesburg",
        schedule_enabled: Boolean(s?.enabled),
      };
    });
  }

  async listSchedules() {
    const db = await this.db;
    return (must(await db.from("sync_schedules").select("*").order("scope")) as SyncScheduleRow[]) ?? [];
  }

  async updateSchedule(id: string, patch: { cron: string; enabled: boolean }, actor: Actor) {
    const db = await this.db;
    must(await db.from("sync_schedules").update({ ...patch, next_run_at: null, updated_by: actor.id, updated_at: new Date().toISOString() }).eq("id", id));
    await this.writeAudit(actor, "schedule.update", id, patch);
  }

  async listJobs(limit: number) {
    const db = await this.db;
    return (must(await db.from("sync_jobs").select("*").order("created_at", { ascending: false }).limit(limit)) as SyncJob[]) ?? [];
  }

  async getJob(id: string) {
    const db = await this.db;
    const { data: job } = await db.from("sync_jobs").select("*").eq("id", id).maybeSingle();
    if (!job) return null;
    const events = must(await db.from("sync_job_events").select("*").eq("job_id", id).order("id")) as SyncJobEvent[];
    return { job: job as SyncJob, events };
  }

  async createJob(input: CreateSyncJobInput, actor: Actor) {
    const db = await this.db;
    const { data: integ } = await db.from("integrations").select("status, cost_per_call_zar").eq("id", input.integration_id).maybeSingle();
    if (!integ || !["active", "sandbox"].includes(String(integ.status))) {
      throw new ConflictError("This integration is not active. Provider access must be verified before syncing.");
    }
    const job = must(
      await db
        .from("sync_jobs")
        .insert({
          integration_id: input.integration_id,
          scope: input.scope,
          target_property_id: input.target_property_id,
          params: input.params,
          trigger: "manual",
          requested_by: actor.id,
          approved_high_cost_by: input.approve_high_cost ? actor.id : null,
          estimated_cost_zar: integ.cost_per_call_zar ?? null,
        })
        .select("*")
        .single(),
    ) as SyncJob;
    await this.writeAudit(actor, "sync.trigger", job.id, { scope: input.scope, target: input.target_property_id, params: input.params });
    return job;
  }

  async cancelJob(id: string, actor: Actor) {
    const db = await this.db;
    const { data: job } = await db.from("sync_jobs").select("status").eq("id", id).maybeSingle();
    if (!job) throw new Error("Job not found");
    const next = job.status === "queued" ? "cancelled" : job.status === "running" ? "cancellation_requested" : null;
    if (!next) throw new ConflictError(`Job is already ${job.status}`);
    must(await db.from("sync_jobs").update({ status: next, ...(next === "cancelled" ? { finished_at: new Date().toISOString() } : {}) }).eq("id", id));
    await this.writeAudit(actor, "sync.cancel", id);
  }

  async listReviewQueue(): Promise<ReviewQueueItem[]> {
    const db = await this.db;
    const [q, lots] = await Promise.all([
      db.from("identity_review_queue").select("*").eq("status", "open").order("created_at"),
      db.from("auction_properties").select("*, auctions(external_id, provider, retrieved_at)").eq("review_status", "needs_review"),
    ]);
    const items = ((must(q) as Row[]) ?? []).map((r) => r as unknown as ReviewQueueItem);
    for (const l of (must(lots) as Row[]) ?? []) {
      const a = l.auctions as Row;
      items.push({
        id: String(l.id),
        created_at: String(a.retrieved_at),
        provider: String(a.provider),
        external_id: String(a.external_id),
        description: `Auction lot: ${l.described_address}`,
        reason: ((l.match_evidence as string[]) ?? [])[0] ?? "Needs review",
        candidates: ((l.candidate_property_ids as string[]) ?? []).map((pid) => ({ property_id: pid, confidence: Number(l.match_confidence), evidence: [], conflicts: [] })),
      });
    }
    return items;
  }

  async listAuditLogs(actor: Actor, all: boolean) {
    const db = await this.db;
    let q = db.from("audit_logs").select("*").order("at", { ascending: false }).limit(200);
    if (!all) q = q.eq("actor_id", actor.id);
    return ((must(await q) as Row[]) ?? []).map((r) => ({ ...(r as unknown as AuditLog), id: String(r.id) }));
  }

  async writeAudit(_actor: Actor, action: string, target: string | null, details?: Record<string, unknown>) {
    const db = await this.db;
    await db.rpc("write_audit", { p_action: action, p_target: target, p_details: details ?? null });
  }

  async toggleWatchlist(propertyId: string, actor: Actor) {
    const db = await this.db;
    const { data } = await db.from("property_watchlists").select("id").eq("user_id", actor.id).eq("property_id", propertyId).maybeSingle();
    if (data) {
      must(await db.from("property_watchlists").delete().eq("id", data.id));
      return false;
    }
    must(await db.from("property_watchlists").insert({ user_id: actor.id, property_id: propertyId }));
    return true;
  }

  async listUsers(): Promise<UserRow[]> {
    const db = await this.db;
    const [profiles, roles] = await Promise.all([db.from("profiles").select("*").order("email"), db.from("user_roles").select("*")]);
    return ((must(profiles) as Row[]) ?? []).map((p) => ({
      id: String(p.id),
      email: String(p.email),
      created_at: String(p.created_at),
      role: ((((roles.data ?? []) as Row[]).find((r) => r.user_id === p.id)?.role as UserRow["role"]) ?? null),
    }));
  }
}
