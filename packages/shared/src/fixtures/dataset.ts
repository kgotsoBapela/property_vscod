/**
 * SYNTHETIC DEMO DATA — NOT REAL PROPERTIES, SALES, AUCTIONS OR SHERIFF DETAILS.
 *
 * Deterministic fixture used until a licensed provider agreement exists (CLAUDE.md: "Use fixture/synthetic
 * data until a provider agreement exists; label demo data"). Suburb, street, scheme, auctioneer and sheriff
 * names are invented. URLs use the reserved example.org domain. Contact details are deliberately absent.
 */

export const FIXTURE_AS_OF = "2026-09-29";

export interface FixtureTransferRaw {
  ref: string;
  price: number | null;
  signed: string | null;
  registered: string | null;
  kind: "market" | "execution" | "estate" | "donation" | "related" | "divorce";
  arms_length: boolean;
  verified: boolean;
  title_deed: string | null;
}

export interface FixturePropertyRaw {
  record_type: "property";
  ref: string;
  address: {
    unit: string | null;
    complex: string | null;
    number: string;
    street: string;
    suburb: string;
    town: string;
    province: string;
    postcode: string | null;
  };
  deeds: {
    erf: string | null;
    portion: string | null;
    township: string | null;
    scheme_name: string | null;
    scheme_no: string | null;
    unit: string | null;
    title_deed: string | null;
    verified: boolean;
  };
  location: { lat: number; lon: number } | null;
  attributes: { type: "house" | "sectional_unit" | "vacant_land"; erf_m2: number | null; floor_m2: number | null; beds: number | null; baths: number | null };
  transfers: FixtureTransferRaw[];
  avm: { ref: string; value: number; low: number; high: number; as_of: string; confidence: "high" | "medium" | "low" } | null;
  _note?: string;
}

export interface FixtureMoney {
  amount: number | null;
  published: boolean;
}

export interface FixtureAuctionRaw {
  record_type: "auction";
  ref: string;
  kind: "sheriff" | "private" | "online";
  house: { ref: string; name: string; website: string | null } | null;
  sheriff: {
    ref: string;
    name: string;
    jurisdiction: string;
    province: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    contact_verified_at: string | null;
    source_url: string | null;
  } | null;
  title: string;
  starts_at: string | null;
  venue: string | null;
  status: "scheduled" | "postponed" | "cancelled" | "sold" | "no_sale" | "withdrawn";
  status_note: string | null;
  guide: FixtureMoney | null;
  reserve: FixtureMoney | null;
  opening_bid: FixtureMoney | null;
  hammer: FixtureMoney | null;
  deposit: string | null;
  conditions: string | null;
  case_no: string | null;
  notice_url: string | null;
  verified_at: string | null;
  lots: {
    lot: string | null;
    address: string;
    erf: string | null;
    portion: string | null;
    township: string | null;
    scheme_name: string | null;
    scheme_no: string | null;
    unit: string | null;
    lat: number | null;
    lon: number | null;
  }[];
  documents: { ref: string; kind: "notice" | "conditions_of_sale" | "gazette" | "other"; title: string; url: string | null; published_at: string | null }[];
}

export type FixtureRaw = FixturePropertyRaw | FixtureAuctionRaw;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUBURBS = [
  { name: "Sample Heights", township: "Sample Heights Ext 1", lat: -26.101, lon: 28.052, ppm2: 14_000, postcode: "0001" },
  { name: "Fixture Park", township: "Fixture Park", lat: -26.114, lon: 28.068, ppm2: 11_000, postcode: "0002" },
  { name: "Demo Ridge", township: "Demo Ridge", lat: -26.089, lon: 28.036, ppm2: 17_500, postcode: "0003" },
];
const STREETS = ["Fixture Street", "Sample Avenue", "Synthetic Road", "Placeholder Crescent", "Testing Drive", "Mock Lane"];
const TOWN = "Demo Metropolitan (synthetic)";
const PROVINCE = "Gauteng";
const GROWTH = 0.05;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const roundTo = (v: number, step: number) => Math.round(v / step) * step;

function transferHistory(
  rand: () => number,
  ref: string,
  valueToday: number,
  firstYear: number,
  titlePrefix: string,
): FixtureTransferRaw[] {
  const out: FixtureTransferRaw[] = [];
  let year = firstYear;
  let n = 0;
  while (year <= 2026) {
    const reg = new Date(Date.UTC(year, Math.floor(rand() * 12), 1 + Math.floor(rand() * 27)));
    if (iso(reg) > FIXTURE_AS_OF) break;
    const signed = addDays(reg, -(60 + Math.floor(rand() * 90)));
    const yearsAgo = (Date.parse(FIXTURE_AS_OF) - reg.getTime()) / (365.25 * 86_400_000);
    const market = valueToday / (1 + GROWTH) ** yearsAgo;
    const roll = rand();
    let kind: FixtureTransferRaw["kind"] = "market";
    let price: number | null = roundTo(market * (0.9 + rand() * 0.2), 5_000);
    let arms = true;
    if (roll < 0.07) {
      kind = "execution";
      price = roundTo(market * (0.55 + rand() * 0.2), 5_000);
      arms = false;
    } else if (roll < 0.1) {
      kind = "related";
      price = roundTo(market * 0.5, 5_000);
      arms = false;
    } else if (roll < 0.12) {
      kind = "donation";
      price = null;
      arms = false;
    } else if (roll < 0.15) {
      kind = "estate";
    }
    n++;
    out.push({
      ref: `${ref}-T${n}`,
      price,
      signed: rand() < 0.8 ? iso(signed) : null,
      registered: iso(reg),
      kind,
      arms_length: arms,
      verified: rand() > 0.05,
      title_deed: `${titlePrefix}${10000 + Math.floor(rand() * 89999)}/${year}`,
    });
    year += 2 + Math.floor(rand() * 7);
  }
  return out;
}

function avmFor(rand: () => number, ref: string, value: number): FixturePropertyRaw["avm"] {
  if (rand() < 0.25) return null; // not every property has an AVM
  const spread = 0.06 + rand() * 0.12;
  const point = roundTo(value * (0.95 + rand() * 0.1), 10_000);
  return {
    ref: `${ref}-AVM`,
    value: point,
    low: roundTo(point * (1 - spread), 10_000),
    high: roundTo(point * (1 + spread), 10_000),
    as_of: "2026-09-01",
    confidence: spread < 0.1 ? "high" : spread < 0.15 ? "medium" : "low",
  };
}

export function buildFixtureProperties(): FixturePropertyRaw[] {
  const rand = mulberry32(20260929);
  const out: FixturePropertyRaw[] = [];
  let seq = 0;
  const nextRef = () => `FXP-${String(++seq).padStart(4, "0")}`;

  // Freehold houses
  for (const s of SUBURBS) {
    for (let i = 0; i < 22; i++) {
      const ref = nextRef();
      const street = STREETS[Math.floor(rand() * STREETS.length)]!;
      const number = String(1 + Math.floor(rand() * 180));
      const floor = roundTo(110 + rand() * 260, 5);
      const erfSize = roundTo(floor * (2.2 + rand() * 2.5), 10);
      const valueToday = floor * s.ppm2 * (0.85 + rand() * 0.3);
      const erf = String(100 + seq * 7);
      out.push({
        record_type: "property",
        ref,
        address: { unit: null, complex: null, number, street, suburb: s.name, town: TOWN, province: PROVINCE, postcode: s.postcode },
        deeds: { erf, portion: null, township: s.township, scheme_name: null, scheme_no: null, unit: null, title_deed: null, verified: true },
        location: { lat: s.lat + (rand() - 0.5) * 0.024, lon: s.lon + (rand() - 0.5) * 0.024 },
        attributes: { type: "house", erf_m2: erfSize, floor_m2: floor, beds: Math.max(2, Math.round(floor / 70)), baths: Math.max(1, Math.round(floor / 110)), },
        transfers: transferHistory(rand, ref, valueToday, 2004 + Math.floor(rand() * 16), "T"),
        avm: avmFor(rand, ref, valueToday),
      });
    }
  }

  // Subdivided erf: two portions of the same erf at neighbouring addresses — must stay separate properties.
  for (const portion of ["1", "2"]) {
    const ref = nextRef();
    const floor = portion === "1" ? 210 : 185;
    const value = floor * 14_000;
    out.push({
      record_type: "property",
      ref,
      address: { unit: null, complex: null, number: portion === "1" ? "40" : "40A", street: "Fixture Street", suburb: "Sample Heights", town: TOWN, province: PROVINCE, postcode: "0001" },
      deeds: { erf: "512", portion, township: "Sample Heights Ext 1", scheme_name: null, scheme_no: null, unit: null, title_deed: null, verified: true },
      location: { lat: -26.1032 + Number(portion) * 0.0002, lon: 28.0511 },
      attributes: { type: "house", erf_m2: 600, floor_m2: floor, beds: 3, baths: 2 },
      transfers: transferHistory(rand, ref, value, 2012, "T"),
      avm: avmFor(rand, ref, value),
    });
  }

  // Two sectional-title schemes. Every unit shares the street address; scheme + unit is the legal identity.
  const schemes = [
    { name: "FIXTURE COURT", no: "SS123/2004", number: "12", street: "Sample Avenue", suburb: SUBURBS[0]!, units: 12, erf: "900" },
    { name: "DEMO VIEW", no: "SS77/2011", number: "5", street: "Testing Drive", suburb: SUBURBS[2]!, units: 10, erf: "1450" },
  ];
  for (const sc of schemes) {
    const lat = sc.suburb.lat + 0.002;
    const lon = sc.suburb.lon - 0.003;
    for (let u = 1; u <= sc.units; u++) {
      const ref = nextRef();
      const floor = roundTo(48 + rand() * 75, 1);
      const value = floor * sc.suburb.ppm2 * 1.1 * (0.9 + rand() * 0.2);
      out.push({
        record_type: "property",
        ref,
        address: { unit: String(u), complex: sc.name, number: sc.number, street: sc.street, suburb: sc.suburb.name, town: TOWN, province: PROVINCE, postcode: sc.suburb.postcode },
        deeds: { erf: sc.erf, portion: null, township: sc.suburb.township, scheme_name: sc.name, scheme_no: sc.no, unit: String(u), title_deed: null, verified: true },
        location: { lat, lon },
        attributes: { type: "sectional_unit", erf_m2: null, floor_m2: floor, beds: floor < 65 ? 1 : 2, baths: 1 },
        transfers: transferHistory(rand, ref, value, 2005 + Math.floor(rand() * 14), "ST"),
        avm: avmFor(rand, ref, value),
      });
    }
  }

  // A property with no licensed history at all: the UI must show an explicit "no data" state.
  out.push({
    record_type: "property",
    ref: nextRef(),
    address: { unit: null, complex: null, number: "77", street: "Mock Lane", suburb: "Fixture Park", town: TOWN, province: PROVINCE, postcode: "0002" },
    deeds: { erf: "7777", portion: null, township: "Fixture Park", scheme_name: null, scheme_no: null, unit: null, title_deed: null, verified: false },
    location: null,
    attributes: { type: "vacant_land", erf_m2: 800, floor_m2: null, beds: null, baths: null },
    transfers: [],
    avm: null,
  });

  // Deliberately invalid payload so validation handling is visible in the sync log.
  out.push({
    record_type: "property",
    ref: nextRef(),
    address: { unit: null, complex: null, number: "1", street: "Invalid Road", suburb: "Fixture Park", town: TOWN, province: PROVINCE, postcode: null },
    deeds: { erf: "1", portion: null, township: "Fixture Park", scheme_name: null, scheme_no: null, unit: null, title_deed: null, verified: true },
    location: { lat: 51.5, lon: -0.12 }, // outside South Africa → rejected by normalized schema
    attributes: { type: "house", erf_m2: 500, floor_m2: 120, beds: 3, baths: 1 },
    transfers: [{ ref: "BAD-T1", price: -5, signed: null, registered: "2020-01-01", kind: "market", arms_length: true, verified: true, title_deed: null }],
    avm: null,
    _note: "Deliberately invalid for validation demo",
  });

  return out;
}

const SHERIFFS = {
  north: {
    ref: "FXS-N",
    name: "Sheriff Demo North (synthetic)",
    jurisdiction: "Demo Metropolitan North magisterial district (synthetic)",
    province: PROVINCE,
    address: null,
    phone: null,
    email: null,
    contact_verified_at: null,
    source_url: "https://example.org/demo/sheriffs/north",
  },
  south: {
    ref: "FXS-S",
    name: "Sheriff Demo South (synthetic)",
    jurisdiction: "Demo Metropolitan South magisterial district (synthetic)",
    province: PROVINCE,
    address: "Address withheld in demo data",
    phone: null,
    email: null,
    contact_verified_at: null,
    source_url: "https://example.org/demo/sheriffs/south",
  },
} satisfies Record<string, FixtureAuctionRaw["sheriff"]>;

const HOUSE = { ref: "FXH-1", name: "Demo Auction House (synthetic)", website: "https://example.org/demo/auction-house" };

export function buildFixtureAuctions(props: FixturePropertyRaw[]): FixtureAuctionRaw[] {
  const pick = (ref: string) => props.find((p) => p.ref === ref)!;
  const lotFrom = (p: FixturePropertyRaw, lot: string | null, overrides: Partial<FixtureAuctionRaw["lots"][number]> = {}) => ({
    lot,
    address: [p.address.unit ? `Unit ${p.address.unit} ${p.address.complex}` : null, `${p.address.number} ${p.address.street}`, p.address.suburb]
      .filter(Boolean)
      .join(", "),
    erf: p.deeds.erf,
    portion: p.deeds.portion,
    township: p.deeds.township,
    scheme_name: p.deeds.scheme_name,
    scheme_no: p.deeds.scheme_no,
    unit: p.deeds.unit,
    lat: p.location?.lat ?? null,
    lon: p.location?.lon ?? null,
    ...overrides,
  });
  const docs = (ref: string, withConditions = true, sheriffSale = true) => [
    { ref: `${ref}-N`, kind: "notice" as const, title: sheriffSale ? "Notice of sale in execution (synthetic)" : "Auction listing notice (synthetic)", url: `https://example.org/demo/notices/${ref}.pdf`, published_at: "2026-09-12T08:00:00+02:00" },
    ...(withConditions
      ? [{ ref: `${ref}-C`, kind: "conditions_of_sale" as const, title: "Conditions of sale (synthetic)", url: `https://example.org/demo/conditions/${ref}.pdf`, published_at: "2026-09-12T08:00:00+02:00" }]
      : []),
  ];
  const unit = props.find((p) => p.deeds.scheme_no === "SS123/2004" && p.deeds.unit === "4")!;

  return [
    {
      record_type: "auction", ref: "FXA-001", kind: "sheriff", house: null, sheriff: SHERIFFS.north,
      title: "Sale in execution — Erf in Sample Heights (synthetic)",
      starts_at: "2026-10-14T10:00:00+02:00", venue: "Demo North sheriff office (synthetic)",
      status: "scheduled", status_note: null,
      guide: null, reserve: { amount: 1_250_000, published: true }, opening_bid: null, hammer: null,
      deposit: "10% of purchase price on the fall of the hammer (synthetic terms)",
      conditions: "Sold voetstoots. Purchaser pays sheriff commission, arrear rates and transfer costs (synthetic summary; read the conditions of sale).",
      case_no: "DEMO-12345/2025", notice_url: "https://example.org/demo/notices/FXA-001.pdf", verified_at: "2026-09-28T09:00:00+02:00",
      lots: [lotFrom(pick("FXP-0003"), "1")], documents: docs("FXA-001"),
    },
    {
      record_type: "auction", ref: "FXA-002", kind: "sheriff", house: null, sheriff: SHERIFFS.south,
      title: "Sale in execution — Sectional unit, FIXTURE COURT (synthetic)",
      starts_at: "2026-10-21T11:00:00+02:00", venue: "Demo South sheriff office (synthetic)",
      status: "postponed", status_note: "Postponed by agreement between parties (synthetic)",
      guide: null, reserve: { amount: null, published: false }, opening_bid: null, hammer: null,
      deposit: "10% deposit plus sheriff commission (synthetic terms)", conditions: null,
      case_no: "DEMO-9876/2026", notice_url: "https://example.org/demo/notices/FXA-002.pdf", verified_at: "2026-09-25T14:30:00+02:00",
      lots: [lotFrom(unit, "1")], documents: docs("FXA-002", false),
    },
    {
      record_type: "auction", ref: "FXA-003", kind: "private", house: HOUSE, sheriff: null,
      title: "On-site auction — Family home, Demo Ridge (synthetic)",
      starts_at: "2026-11-05T12:00:00+02:00", venue: "On site (synthetic)",
      status: "scheduled", status_note: null,
      guide: { amount: 3_400_000, published: true }, reserve: { amount: null, published: false }, opening_bid: { amount: 2_900_000, published: true }, hammer: null,
      deposit: "Buyer's commission and deposit per conditions of sale (synthetic)", conditions: "Subject to seller confirmation within 7 business days (synthetic).",
      case_no: null, notice_url: "https://example.org/demo/auctions/FXA-003", verified_at: "2026-09-27T10:00:00+02:00",
      lots: [lotFrom(pick("FXP-0050"), "A")], documents: docs("FXA-003", true, false),
    },
    {
      record_type: "auction", ref: "FXA-004", kind: "sheriff", house: null, sheriff: SHERIFFS.north,
      title: "Sale in execution — Fixture Park (synthetic)",
      starts_at: "2026-10-02T10:00:00+02:00", venue: "Demo North sheriff office (synthetic)",
      status: "cancelled", status_note: "Cancelled: judgment debt settled (synthetic)",
      guide: null, reserve: { amount: 820_000, published: true }, opening_bid: null, hammer: null,
      deposit: null, conditions: null,
      case_no: "DEMO-4444/2025", notice_url: "https://example.org/demo/notices/FXA-004.pdf", verified_at: "2026-09-29T07:45:00+02:00",
      lots: [lotFrom(pick("FXP-0030"), "1")], documents: docs("FXA-004", false),
    },
    {
      record_type: "auction", ref: "FXA-005", kind: "online", house: HOUSE, sheriff: null,
      title: "Online auction — Sample Heights (synthetic)",
      starts_at: "2026-08-20T14:00:00+02:00", venue: "Online (synthetic)",
      status: "sold", status_note: "Hammer price confirmed by auctioneer (synthetic)",
      guide: { amount: 2_100_000, published: true }, reserve: null, opening_bid: { amount: 1_800_000, published: true }, hammer: { amount: 2_050_000, published: true },
      deposit: null, conditions: null, case_no: null,
      notice_url: "https://example.org/demo/auctions/FXA-005", verified_at: "2026-08-21T09:00:00+02:00",
      lots: [lotFrom(pick("FXP-0010"), "1")], documents: docs("FXA-005", false, false),
    },
    {
      // Address-only lot description: identity cannot be confirmed, so it must go to human review.
      record_type: "auction", ref: "FXA-006", kind: "sheriff", house: null, sheriff: SHERIFFS.south,
      title: "Sale in execution — unit described by street address only (synthetic)",
      starts_at: "2026-10-28T10:00:00+02:00", venue: "Demo South sheriff office (synthetic)",
      status: "scheduled", status_note: null,
      guide: null, reserve: { amount: null, published: false }, opening_bid: null, hammer: null,
      deposit: "10% deposit (synthetic terms)", conditions: null,
      case_no: "DEMO-5555/2026", notice_url: "https://example.org/demo/notices/FXA-006.pdf", verified_at: "2026-09-26T12:00:00+02:00",
      lots: [{ lot: "1", address: "12 Sample Avenue, Sample Heights", erf: null, portion: null, township: null, scheme_name: null, scheme_no: null, unit: null, lat: null, lon: null }],
      documents: docs("FXA-006"),
    },
  ];
}

let cached: { properties: FixturePropertyRaw[]; auctions: FixtureAuctionRaw[] } | null = null;

export function fixtureDataset() {
  if (!cached) {
    const properties = buildFixtureProperties();
    cached = { properties, auctions: buildFixtureAuctions(properties) };
  }
  return cached;
}
