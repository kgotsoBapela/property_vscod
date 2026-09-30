import { describe, expect, it } from "vitest";
import { analyzeComparables, DEFAULT_COMPARABLE_FILTERS } from "../src/analysis/comparables";
import { calculateAcquisition, calculateTransferDuty, TRANSFER_DUTY_TABLES, type AcquisitionInputs } from "../src/analysis/acquisition";
import { recentRegisteredTransfers, appreciationBetweenSales } from "../src/analysis/trends";
import type { ComparableCandidate, Property, PropertySale } from "../src/types/domain";

const prov = { provider: "t", source_record_id: null, retrieved_at: "2026-09-01T00:00:00Z", is_demo: false };
const prop = (id: string, lat: number, floor: number, type: Property["property_type"] = "freehold"): Property => ({
  id,
  normalized_address: id,
  street_number: "1",
  street_name: "A",
  unit_number: null,
  complex_name: null,
  suburb: "S",
  municipality: null,
  province: "Gauteng",
  postal_code: null,
  latitude: lat,
  longitude: 28,
  property_type: type,
  erf_size_m2: null,
  floor_size_m2: floor,
  bedrooms: 3,
  bathrooms: 2,
  is_demo: false,
  updated_at: "",
});
const sale = (id: string, pid: string, amount: number | null, date: string, extra: Partial<PropertySale> = {}): PropertySale => ({
  id,
  property_id: pid,
  transfer_amount: amount,
  sale_date: null,
  registration_date: date,
  transfer_type: "market_sale",
  is_arms_length: true,
  title_deed: null,
  verification_status: "verified",
  provenance: prov,
  ...extra,
});

describe("comparable analysis", () => {
  const subject = prop("subject", -26.1, 200);
  const cands: ComparableCandidate[] = [
    { property: prop("a", -26.101, 200), sale: sale("s1", "a", 2_000_000, "2026-01-10"), distance_m: 0 },
    { property: prop("b", -26.102, 180), sale: sale("s2", "b", 1_800_000, "2025-11-10"), distance_m: 0 },
    { property: prop("c", -26.103, 220), sale: sale("s3", "c", 2_300_000, "2025-06-10"), distance_m: 0 },
    {
      property: prop("d", -26.104, 200),
      sale: sale("s4", "d", 900_000, "2025-06-10", { transfer_type: "sale_in_execution", is_arms_length: false }),
      distance_m: 0,
    },
    { property: prop("e", -26.2, 200), sale: sale("s5", "e", 2_000_000, "2025-06-10"), distance_m: 0 },
    { property: prop("f", -26.101, 200), sale: sale("s6", "f", 2_000_000, "2019-01-10"), distance_m: 0 },
    { property: prop("g", -26.101, 60, "sectional_title"), sale: sale("s7", "g", 900_000, "2026-01-10"), distance_m: 0 },
    { property: prop("h", -26.101, 200), sale: sale("s8", "h", null, "2026-01-10"), distance_m: 0 },
  ];
  const r = analyzeComparables(subject, cands, DEFAULT_COMPARABLE_FILTERS, "2026-09-29", null);
  const by = (id: string) => r.comps.find((c) => c.sale_id === id)!;

  it("includes only filtered arm's-length verified sales", () => {
    expect(r.comps.filter((c) => c.included).map((c) => c.sale_id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(by("s4").exclusion_reasons[0]).toMatch(/Non-arm's-length/);
    expect(by("s5").exclusion_reasons[0]).toMatch(/Outside/);
    expect(by("s6").exclusion_reasons[0]).toMatch(/Older/);
    expect(by("s7").exclusion_reasons[0]).toMatch(/type/);
    expect(by("s8").exclusion_reasons[0]).toMatch(/not disclosed/);
  });

  it("applies explained size adjustments and reports low confidence for a small sample", () => {
    expect(by("s2").adjustments[0]?.factor).toBe("floor_size");
    expect(by("s2").adjusted_price).toBeGreaterThan(1_800_000);
    expect(r.indication.confidence).toBe("low");
    expect(r.indication.explanation.join(" ")).toMatch(/no time adjustment/i);
  });

  it("honours analyst overrides but never includes a sale without a price", () => {
    const o = analyzeComparables(
      subject,
      cands,
      { ...DEFAULT_COMPARABLE_FILTERS, overrides: { s4: "include", s8: "include", s1: "exclude" } },
      "2026-09-29",
      0.05,
    );
    expect(o.comps.filter((c) => c.included).map((c) => c.sale_id).sort()).toEqual(["s2", "s3", "s4"]);
    expect(o.comps.find((c) => c.sale_id === "s2")!.adjustments.some((a) => a.factor === "time")).toBe(true);
  });

  it("returns insufficient_data with no comps", () => {
    const e = analyzeComparables(subject, [], DEFAULT_COMPARABLE_FILTERS, "2026-09-29", null);
    expect(e.indication).toMatchObject({ confidence: "insufficient_data", median_adjusted: null });
  });
});

describe("acquisition costs", () => {
  const t = TRANSFER_DUTY_TABLES[0]!;
  it("calculates transfer duty per bracket", () => {
    expect(calculateTransferDuty(1_000_000, t)).toBe(0);
    expect(calculateTransferDuty(1_500_000, t)).toBe(8_700);
    expect(calculateTransferDuty(2_000_000, t)).toBe(13_614 + Math.round(336_200 * 0.06));
  });

  const base: AcquisitionInputs = {
    purchase_price: 1_500_000,
    purchase_route: "sheriff_sale",
    as_of_date: "2026-09-29",
    vat_transaction: false,
    buyer_commission_pct: null,
    vat_rate: 0.15,
    conveyancing_fees: 40_000,
    bond_costs: 0,
    rates_arrears: null,
    levy_arrears: null,
    sheriff_or_auction_fees: null,
    renovation_allowance: 100_000,
    holding_costs: null,
    other_costs: 0,
  };

  it("never treats unknown costs as zero", () => {
    const r = calculateAcquisition(base);
    expect(r.total_is_complete).toBe(false);
    expect(r.unknown_items).toEqual(expect.arrayContaining(["Municipal rates & services arrears", "Buyer's commission / premium"]));
    expect(r.line_items.find((i) => i.key === "rates_arrears")).toMatchObject({ amount: null, status: "unknown" });
    expect(r.known_total).toBe(1_500_000 + 8_700 + 40_000 + 100_000);
  });

  it("marks transfer duty not applicable for VAT transactions", () => {
    const r = calculateAcquisition({ ...base, vat_transaction: true });
    expect(r.line_items.find((i) => i.key === "transfer_duty")?.status).toBe("not_applicable");
  });
});

describe("sale history", () => {
  const sales = [
    sale("1", "p", 1_000_000, "2010-01-01"),
    sale("2", "p", 1_200_000, "2013-01-01"),
    sale("3", "p", 1_500_000, "2016-01-01"),
    sale("4", "p", 1_700_000, "2019-01-01"),
    sale("5", "p", 2_000_000, "2022-01-01"),
    sale("6", "p", 2_300_000, "2025-01-01"),
    sale("7", "p", 5, "2025-06-01", { verification_status: "unverified" }),
  ];
  it("returns at most five verified transfers newest first, with the total available", () => {
    const r = recentRegisteredTransfers(sales);
    expect(r.transfers.map((s) => s.id)).toEqual(["6", "5", "4", "3", "2"]);
    expect(r.available).toBe(6);
  });
  it("computes appreciation between consecutive sales", () => {
    const a = appreciationBetweenSales(sales);
    expect(a).toHaveLength(5);
    expect(a[0]!.total_change_pct).toBeCloseTo(20);
  });
});
