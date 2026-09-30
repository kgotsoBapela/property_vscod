import { describe, expect, it } from "vitest";
import { createFixtureAdapter, MemorySyncStore, runSyncJob, type SyncJob } from "@propintel/shared";
import { rankProperties } from "./search";

async function fixtureStore() {
  const store = new MemorySyncStore();
  const job = store.createJob({
    integration_id: "fixture",
    scope: "full_reconciliation",
    target_property_id: null,
    params: {},
    status: "queued",
    trigger: "schedule",
    requested_by: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    records_fetched: 0,
    records_upserted: 0,
    records_failed: 0,
    estimated_cost_zar: 0,
    error_category: null,
    error_message: null,
  } satisfies Omit<SyncJob, "id">);
  await runSyncJob(job, createFixtureAdapter(), store, {});
  const search = (q: string) => rankProperties(q, store.properties.values(), (id) => store.identifiers.filter((i) => i.property_id === id));
  return { store, search };
}

describe("property search ranking", async () => {
  const { search } = await fixtureStore();

  it("finds a property by erf number and explains why", () => {
    const r = search("erf 107");
    expect(r).toHaveLength(1);
    expect(r[0]!.match_reasons[0]).toMatch(/Erf 107/);
  });

  it("distinguishes erf portions", () => {
    const both = search("erf 512");
    expect(both).toHaveLength(2);
    const p2 = search("erf 512 portion 2");
    expect(p2).toHaveLength(1);
    expect(p2[0]!.property.street_number).toBe("40A");
  });

  it("returns every unit that shares a street address", () => {
    const r = search("12 Sample Avenue");
    expect(r.filter((x) => x.property.complex_name === "FIXTURE COURT")).toHaveLength(12);
  });

  it("narrows to one unit with unit + scheme identifiers", () => {
    const r = search("unit 4 SS 123/2004");
    expect(r).toHaveLength(1);
    expect(r[0]!.property.unit_number).toBe("4");
  });

  it("requires every address word to match for text-only searches", () => {
    expect(search("Sample Heights")).not.toHaveLength(0);
    expect(search("Nonexistent Street")).toHaveLength(0);
  });

  it("ranks an exact street number above other matches", () => {
    const r = search("40 Fixture Street");
    expect(r[0]!.property.street_number).toBe("40");
  });
});
