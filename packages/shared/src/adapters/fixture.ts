import { z } from "zod";
import { haversineMeters } from "../analysis/geo";
import { fixtureDataset, type FixtureAuctionRaw, type FixturePropertyRaw, type FixtureRaw } from "../fixtures/dataset";
import { normalizeAddress, streetAddressKey } from "../matching/address";
import type { NormalizedRecord } from "../schemas/normalized";
import type { TransferType } from "../types/domain";
import { AdapterError, type AdapterPage, type FetchRequest, type SourceAdapter } from "./types";

/**
 * Adapter for the SYNTHETIC fixture provider. It exercises the full adapter contract (pagination,
 * cursors, validation, failure injection) without any network access or paid calls.
 */

const money = z.object({ amount: z.number().nullable(), published: z.boolean() }).nullable();

const fixturePropertyRawSchema = z.object({
  record_type: z.literal("property"),
  ref: z.string(),
  address: z.object({
    unit: z.string().nullable(),
    complex: z.string().nullable(),
    number: z.string(),
    street: z.string(),
    suburb: z.string(),
    town: z.string(),
    province: z.string(),
    postcode: z.string().nullable(),
  }),
  deeds: z.object({
    erf: z.string().nullable(),
    portion: z.string().nullable(),
    township: z.string().nullable(),
    scheme_name: z.string().nullable(),
    scheme_no: z.string().nullable(),
    unit: z.string().nullable(),
    title_deed: z.string().nullable(),
    verified: z.boolean(),
  }),
  location: z.object({ lat: z.number(), lon: z.number() }).nullable(),
  attributes: z.object({
    type: z.enum(["house", "sectional_unit", "vacant_land"]),
    erf_m2: z.number().nullable(),
    floor_m2: z.number().nullable(),
    beds: z.number().nullable(),
    baths: z.number().nullable(),
  }),
  transfers: z.array(
    z.object({
      ref: z.string(),
      price: z.number().nullable(),
      signed: z.string().nullable(),
      registered: z.string().nullable(),
      kind: z.enum(["market", "execution", "estate", "donation", "related", "divorce"]),
      arms_length: z.boolean(),
      verified: z.boolean(),
      title_deed: z.string().nullable(),
    }),
  ),
  avm: z
    .object({
      ref: z.string(),
      value: z.number(),
      low: z.number(),
      high: z.number(),
      as_of: z.string(),
      confidence: z.enum(["high", "medium", "low"]),
    })
    .nullable(),
  _note: z.string().optional(),
});

const fixtureAuctionRawSchema = z.object({
  record_type: z.literal("auction"),
  ref: z.string(),
  kind: z.enum(["sheriff", "private", "online"]),
  house: z.object({ ref: z.string(), name: z.string(), website: z.string().nullable() }).nullable(),
  sheriff: z
    .object({
      ref: z.string(),
      name: z.string(),
      jurisdiction: z.string(),
      province: z.string(),
      address: z.string().nullable(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      contact_verified_at: z.string().nullable(),
      source_url: z.string().nullable(),
    })
    .nullable(),
  title: z.string(),
  starts_at: z.string().nullable(),
  venue: z.string().nullable(),
  status: z.enum(["scheduled", "postponed", "cancelled", "sold", "no_sale", "withdrawn"]),
  status_note: z.string().nullable(),
  guide: money,
  reserve: money,
  opening_bid: money,
  hammer: money,
  deposit: z.string().nullable(),
  conditions: z.string().nullable(),
  case_no: z.string().nullable(),
  notice_url: z.string().nullable(),
  verified_at: z.string().nullable(),
  lots: z.array(
    z.object({
      lot: z.string().nullable(),
      address: z.string(),
      erf: z.string().nullable(),
      portion: z.string().nullable(),
      township: z.string().nullable(),
      scheme_name: z.string().nullable(),
      scheme_no: z.string().nullable(),
      unit: z.string().nullable(),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      ref: z.string(),
      kind: z.enum(["notice", "conditions_of_sale", "gazette", "other"]),
      title: z.string(),
      url: z.string().nullable(),
      published_at: z.string().nullable(),
    }),
  ),
});

export const fixtureRawSchema = z.discriminatedUnion("record_type", [fixturePropertyRawSchema, fixtureAuctionRawSchema]);

const TRANSFER_KIND: Record<FixturePropertyRaw["transfers"][number]["kind"], TransferType> = {
  market: "market_sale",
  execution: "sale_in_execution",
  estate: "deceased_estate",
  donation: "donation",
  related: "related_party",
  divorce: "divorce",
};

export function displayAddress(a: FixturePropertyRaw["address"]): string {
  const unit = a.unit ? `Unit ${a.unit}${a.complex ? ` ${a.complex}` : ""}, ` : "";
  return `${unit}${a.number} ${a.street}, ${a.suburb}`;
}

function normalizeProperty(r: FixturePropertyRaw): NormalizedRecord {
  return {
    type: "property",
    external_id: r.ref,
    address: displayAddress(r.address),
    street_number: r.address.number,
    street_name: r.address.street,
    unit_number: r.address.unit,
    complex_name: r.address.complex,
    suburb: r.address.suburb,
    municipality: r.address.town,
    province: r.address.province,
    postal_code: r.address.postcode,
    latitude: r.location?.lat ?? null,
    longitude: r.location?.lon ?? null,
    property_type: r.attributes.type === "sectional_unit" ? "sectional_title" : r.attributes.type === "vacant_land" ? "vacant_land" : "freehold",
    erf_size_m2: r.attributes.erf_m2,
    floor_size_m2: r.attributes.floor_m2,
    bedrooms: r.attributes.beds,
    bathrooms: r.attributes.baths,
    erf_number: r.deeds.erf,
    portion: r.deeds.portion,
    township: r.deeds.township,
    scheme_name: r.deeds.scheme_name,
    scheme_number: r.deeds.scheme_no,
    title_deed: r.deeds.title_deed,
    identifiers_verified: r.deeds.verified,
    sales: r.transfers.map((t) => ({
      external_id: t.ref,
      transfer_amount: t.price,
      sale_date: t.signed,
      registration_date: t.registered,
      transfer_type: TRANSFER_KIND[t.kind],
      is_arms_length: t.arms_length,
      title_deed: t.title_deed,
      verification_status: t.verified ? "verified" : "unverified",
    })),
    valuations: r.avm
      ? [
          {
            external_id: r.avm.ref,
            model: "Fixture AVM (synthetic)",
            methodology_version: "fixture-1",
            point_estimate: r.avm.value,
            range_low: r.avm.low,
            range_high: r.avm.high,
            as_of_date: r.avm.as_of,
            confidence: r.avm.confidence,
            confidence_notes: "Synthetic demo estimate. Not a valuation.",
          },
        ]
      : [],
  };
}

function normalizeAuction(r: FixtureAuctionRaw): NormalizedRecord {
  const prices = (
    [
      ["auction_guide", r.guide],
      ["auction_reserve", r.reserve],
      ["opening_bid", r.opening_bid],
      ["confirmed_hammer", r.hammer],
    ] as const
  )
    .filter(([, m]) => m != null)
    .map(([kind, m]) => ({ kind, amount: m!.amount, published: m!.published }));
  return {
    type: "auction",
    external_id: r.ref,
    kind: r.kind === "sheriff" ? "sheriff_sale" : r.kind === "private" ? "private_auction" : "online_auction",
    auction_house: r.house ? { external_id: r.house.ref, name: r.house.name, website: r.house.website } : null,
    sheriff_office: r.sheriff
      ? {
          external_id: r.sheriff.ref,
          name: r.sheriff.name,
          jurisdiction: r.sheriff.jurisdiction,
          province: r.sheriff.province,
          physical_address: r.sheriff.address,
          phone: r.sheriff.phone,
          email: r.sheriff.email,
          contact_verified_at: r.sheriff.contact_verified_at,
          source_url: r.sheriff.source_url,
        }
      : null,
    title: r.title,
    event_at: r.starts_at,
    venue: r.venue,
    status: r.status,
    status_note: r.status_note,
    prices,
    deposit_terms: r.deposit,
    conditions_summary: r.conditions,
    case_reference: r.case_no,
    notice_url: r.notice_url,
    verified_at: r.verified_at,
    lots: r.lots.map((l) => ({
      lot_number: l.lot,
      described_address: l.address,
      erf_number: l.erf,
      portion: l.portion,
      township: l.township,
      scheme_name: l.scheme_name,
      scheme_number: l.scheme_no,
      unit_number: l.unit,
      latitude: l.lat,
      longitude: l.lon,
    })),
    documents: r.documents.map((d) => ({ external_id: d.ref, kind: d.kind, title: d.title, url: d.url, published_at: d.published_at })),
  };
}

const PAGE_SIZE = 25;

function page<T>(items: T[], cursor: string | null): { slice: T[]; next: string | null; checkpoint: string } {
  const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
  const slice = items.slice(offset, offset + PAGE_SIZE);
  const end = offset + slice.length;
  return { slice, next: end < items.length ? String(end) : null, checkpoint: String(end) };
}

function matchesSubject(p: FixturePropertyRaw, s: NonNullable<FetchRequest["subject"]>): boolean {
  const eq = (a: string | null, b: string | null) => a != null && b != null && a.toLowerCase() === b.toLowerCase();
  if (s.scheme_number || s.scheme_name) {
    return (eq(p.deeds.scheme_no, s.scheme_number) || eq(p.deeds.scheme_name, s.scheme_name)) && eq(p.deeds.unit, s.unit_number);
  }
  if (s.erf_number) {
    return eq(p.deeds.erf, s.erf_number) && (p.deeds.portion ?? null) === (s.portion ?? null) && (!s.township || eq(p.deeds.township, s.township));
  }
  return normalizeAddress(displayAddress(p.address)) === normalizeAddress(s.address) ||
    streetAddressKey(p.address.number, p.address.street, p.address.suburb) === normalizeAddress(s.address);
}

export interface FixtureAdapterOptions {
  /** Simulated latency per page, ms. */
  latencyMs?: number;
}

export function createFixtureAdapter(opts: FixtureAdapterOptions = {}): SourceAdapter<FixtureRaw> {
  const data = fixtureDataset();
  const delay = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (!opts.latencyMs) return resolve();
      const t = setTimeout(resolve, opts.latencyMs);
      signal?.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new AdapterError("timeout", "aborted"));
      });
    });

  return {
    key: "fixture_demo",
    displayName: "Synthetic fixture provider (DEMO)",
    isDemo: true,
    scopes: ["subject_property", "nearby_sales", "auctions", "provider_incremental", "full_reconciliation"],
    rawSchema: fixtureRawSchema as unknown as z.ZodType<FixtureRaw>,
    licensing: { may_store_raw: true, retention_days: null, display_rights: "Synthetic data; no licence required" },
    estimateCostZar: () => 0,
    externalId: (raw) => raw.ref,
    normalize: (raw) => (raw.record_type === "property" ? normalizeProperty(raw) : normalizeAuction(raw)),

    async fetchPage(req: FetchRequest): Promise<AdapterPage> {
      await delay(req.signal);
      const failure = req.params.simulate_failure;
      const offset = req.cursor ? Number.parseInt(req.cursor, 10) || 0 : 0;
      if (failure === "first_page" || (failure === "after_first_page" && offset > 0)) {
        throw new AdapterError("transient", "Simulated provider outage (fixture failure injection)");
      }

      switch (req.scope) {
        case "subject_property": {
          if (!req.subject) throw new AdapterError("validation", "subject is required");
          const hits = data.properties.filter((p) => matchesSubject(p, req.subject!));
          return { records: hits, next_cursor: null, checkpoint: null, paid_calls: 1 };
        }
        case "nearby_sales": {
          const s = req.subject;
          if (!s || s.latitude == null || s.longitude == null) {
            throw new AdapterError("validation", "Subject has no licensed coordinates; cannot search nearby sales");
          }
          const radius = req.radius_m ?? 1500;
          const near = data.properties.filter(
            (p) => p.location && haversineMeters(s.latitude!, s.longitude!, p.location.lat, p.location.lon) <= radius,
          );
          const { slice, next, checkpoint } = page(near, req.cursor);
          return { records: slice, next_cursor: next, checkpoint, paid_calls: 1 };
        }
        case "auctions": {
          const { slice, next, checkpoint } = page(data.auctions, req.cursor);
          // Auction checkpoints restart each run: statuses change and must be re-verified.
          return { records: slice, next_cursor: next, checkpoint: next ? checkpoint : null, paid_calls: 1 };
        }
        case "provider_incremental":
        case "full_reconciliation": {
          const all: FixtureRaw[] = [...data.properties, ...data.auctions];
          const { slice, next, checkpoint } = page(all, req.cursor);
          return { records: slice, next_cursor: next, checkpoint, paid_calls: 1 };
        }
      }
    },
  };
}
