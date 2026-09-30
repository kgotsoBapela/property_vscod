import { describe, expect, it } from "vitest";
import { resolveIdentity, type CanonicalCandidate, type IdentityFacts } from "../src/matching/identity";
import { parseSearchQuery, normalizeAddress } from "../src/matching/address";

const blank: IdentityFacts = {
  address: null,
  erf_number: null,
  portion: null,
  township: null,
  scheme_name: null,
  scheme_number: null,
  unit_number: null,
  latitude: null,
  longitude: null,
  provider_ids: [],
};
const unit = (id: string, u: string): CanonicalCandidate => ({
  ...blank,
  property_id: id,
  address: "12 sample avenue sample heights",
  erf_number: "900",
  township: "Sample Heights Ext 1",
  scheme_name: "FIXTURE COURT",
  scheme_number: "SS123/2004",
  unit_number: u,
  latitude: -26.1,
  longitude: 28.05,
});

describe("identity resolution", () => {
  it("auto-matches the same sectional unit", () => {
    const d = resolveIdentity({ ...unit("x", "4") }, [unit("a", "3"), unit("b", "4"), unit("c", "5")]);
    expect(d).toMatchObject({ kind: "auto_match", property_id: "b" });
  });

  it("never merges a different unit at the same street address", () => {
    const d = resolveIdentity({ ...unit("x", "13") }, [unit("a", "3"), unit("b", "4")]);
    expect(d.kind).toBe("new_property");
  });

  it("sends an address-only description of a sectional complex to review", () => {
    const d = resolveIdentity({ ...blank, address: "12 Sample Ave, Sample Heights" }, [unit("a", "3"), unit("b", "4")]);
    expect(d.kind).toBe("needs_review");
    if (d.kind === "needs_review") expect(d.candidates.map((c) => c.property_id).sort()).toEqual(["a", "b"]);
  });

  it("keeps different portions of one erf apart", () => {
    const p1: CanonicalCandidate = { ...blank, property_id: "p1", erf_number: "512", portion: "1", township: "T", latitude: -26.1, longitude: 28.05 };
    const d = resolveIdentity({ ...blank, erf_number: "512", portion: "2", township: "T", latitude: -26.1001, longitude: 28.05 }, [p1]);
    expect(d.kind).toBe("new_property");
  });

  it("treats different erf numbers at the same street address as different properties", () => {
    const c: CanonicalCandidate = { ...blank, property_id: "p", address: "130 testing drive sample heights", erf_number: "142", township: "T", latitude: -26.1, longitude: 28.05 };
    const d = resolveIdentity({ ...blank, address: "130 Testing Drive, Sample Heights", erf_number: "450", township: "T", latitude: -26.1, longitude: 28.05 }, [c]);
    expect(d.kind).toBe("new_property");
  });

  it("matches the same erf in the same township", () => {
    const c: CanonicalCandidate = { ...blank, property_id: "p", erf_number: "0123", township: "Demo Ridge" };
    expect(resolveIdentity({ ...blank, erf_number: "123", township: "demo ridge" }, [c])).toMatchObject({ kind: "auto_match" });
  });

  it("treats the same erf number in another township as a different property", () => {
    const c: CanonicalCandidate = { ...blank, property_id: "p", erf_number: "123", township: "A" };
    expect(resolveIdentity({ ...blank, erf_number: "123", township: "B" }, [c]).kind).toBe("new_property");
  });

  it("uses provider ids as strong evidence", () => {
    const c: CanonicalCandidate = { ...blank, property_id: "p", provider_ids: [{ provider: "x", external_id: "1" }] };
    expect(resolveIdentity({ ...blank, provider_ids: [{ provider: "x", external_id: "1" }] }, [c])).toMatchObject({
      kind: "auto_match",
      property_id: "p",
    });
  });
});

describe("address parsing", () => {
  it("extracts legal identifiers", () => {
    expect(parseSearchQuery("Erf 1234 portion 5")).toMatchObject({ erf_number: "1234", portion: "5" });
    expect(parseSearchQuery("unit 12 SS 123 / 2004")).toMatchObject({ unit_number: "12", scheme_number: "123/2004" });
    expect(parseSearchQuery("40A Fixture St").street_number).toBe("40a");
  });
  it("normalises street suffixes", () => {
    expect(normalizeAddress("12 Sample Ave., Sample Heights")).toBe("12 sample avenue sample heights");
  });
});
