import { describe, expect, it } from "vitest";
import { createFixtureAdapter } from "../src/adapters/fixture";
import { AdapterError, type SourceAdapter } from "../src/adapters/types";
import { redact, runSyncJob } from "../src/sync/pipeline";
import { MemorySyncStore } from "../src/sync/memory-store";
import { withRetry } from "../src/sync/retry";
import type { SyncJob, SyncScope } from "../src/types/domain";

const noSleep = { retries: 2, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 1000, sleep: async () => {} };

function newJob(store: MemorySyncStore, scope: SyncScope, params: Record<string, unknown> = {}): SyncJob {
  return store.createJob({
    integration_id: "fixture",
    scope,
    target_property_id: null,
    params,
    status: "queued",
    trigger: "manual",
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
  });
}

async function fullSync(store: MemorySyncStore, params: Record<string, unknown> = {}) {
  return runSyncJob(newJob(store, "full_reconciliation", params), createFixtureAdapter(), store, {}, { retry: noSleep });
}

describe("sync pipeline with the fixture adapter", () => {
  it("ingests everything, rejects the invalid record and reports partial completion", async () => {
    const store = new MemorySyncStore();
    const r = await fullSync(store);
    expect(r.status).toBe("partially_completed");
    expect(r.failed).toBe(1);
    expect(store.properties.size).toBeGreaterThan(80);
    expect(store.auctions.size).toBe(6);
    expect(store.events.some((e) => e.message.includes("invalid"))).toBe(true);
  });

  it("keeps every sectional unit as its own property", async () => {
    const store = new MemorySyncStore();
    await fullSync(store);
    const units = [...store.properties.values()].filter((p) => p.complex_name === "FIXTURE COURT");
    expect(units).toHaveLength(12);
    expect(new Set(units.map((u) => u.unit_number)).size).toBe(12);
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    const store = new MemorySyncStore();
    await fullSync(store);
    const counts = [store.properties.size, store.sales.size, store.auctions.size, store.identifiers.length];
    const r2 = await fullSync(store);
    expect([store.properties.size, store.sales.size, store.auctions.size, store.identifiers.length]).toEqual(counts);
    expect(r2.unchanged).toBeGreaterThan(80);
  });

  it("links auction lots and sends address-only lots to review", async () => {
    const store = new MemorySyncStore();
    await fullSync(store);
    const byLot = (ref: string) => {
      const a = [...store.auctions.entries()].find(([k]) => k.endsWith(ref))![1];
      return store.auctionLinks.find((l) => l.auction_id === a.id)!;
    };
    expect(byLot("FXA-001").review_status).toBe("auto_matched");
    const ambiguous = byLot("FXA-006");
    expect(ambiguous.review_status).toBe("needs_review");
    expect(ambiguous.property_id).toBeNull();
    expect(ambiguous.candidate_property_ids.length).toBe(12);
  });

  it("preserves prior data and the checkpoint when a refresh fails midway", async () => {
    const store = new MemorySyncStore();
    await fullSync(store);
    const before = store.snapshot();
    const job = newJob(store, "provider_incremental", { simulate_failure: "after_first_page" });
    await store.saveCheckpoint("fixture", "provider_incremental", null);
    const r = await runSyncJob(job, createFixtureAdapter(), store, {}, { retry: noSleep });
    expect(["failed", "partially_completed"]).toContain(r.status);
    expect(r.error_category).toBe("transient");
    expect(store.snapshot()).toEqual(before);
    // Only the first (committed) page advanced the checkpoint.
    expect(await store.getCheckpoint("fixture", "provider_incremental")).toBe("25");
  });

  it("does not advance the checkpoint when a commit fails", async () => {
    const store = new MemorySyncStore();
    store.failCommitFor = "FXP-0003";
    const r = await runSyncJob(newJob(store, "provider_incremental"), createFixtureAdapter(), store, {}, { retry: noSleep });
    expect(r.status).toBe("failed");
    expect(r.error_category).toBe("storage");
    expect(await store.getCheckpoint("fixture", "provider_incremental")).toBeNull();
  });

  it("resumes an incremental sync from its checkpoint", async () => {
    const store = new MemorySyncStore();
    await store.saveCheckpoint("fixture", "provider_incremental", "50");
    const r = await runSyncJob(newJob(store, "provider_incremental"), createFixtureAdapter(), store, {}, { retry: noSleep });
    expect(store.properties.has("00000000-0000-4000-8001-000000000001")).toBe(true);
    expect(r.fetched).toBeLessThan(100); // skipped the first 50 records
  });

  it("stops at a page boundary when cancellation is requested", async () => {
    const store = new MemorySyncStore();
    const job = newJob(store, "full_reconciliation");
    const origUpdate = store.updateJob.bind(store);
    let pages = 0;
    store.updateJob = async (id, patch) => {
      await origUpdate(id, patch);
      if (patch.records_fetched && ++pages === 1) await origUpdate(id, { status: "cancellation_requested" });
    };
    const r = await runSyncJob(job, createFixtureAdapter(), store, {}, { retry: noSleep });
    expect(r.status).toBe("cancelled");
    expect(r.fetched).toBe(25);
  });

  it("fetches a subject property by legal identifiers", async () => {
    const store = new MemorySyncStore();
    const job = newJob(store, "subject_property");
    const r = await runSyncJob(job, createFixtureAdapter(), store, {
      subject: {
        address: "",
        erf_number: "900",
        portion: null,
        township: "Sample Heights Ext 1",
        scheme_name: "FIXTURE COURT",
        scheme_number: "SS123/2004",
        unit_number: "4",
        latitude: null,
        longitude: null,
      },
    });
    expect(r.status).toBe("completed");
    expect(r.fetched).toBe(1);
  });

  it("stops at the paid-call quota", async () => {
    const store = new MemorySyncStore();
    const r = await runSyncJob(newJob(store, "full_reconciliation"), createFixtureAdapter(), store, {}, { retry: noSleep, maxPaidCalls: 2 });
    expect(r.status).toBe("partially_completed");
    expect(r.error_category).toBe("quota_exceeded");
    expect(r.paid_calls).toBe(2);
  });

  it("rejects scopes the adapter does not support", async () => {
    const store = new MemorySyncStore();
    const limited: SourceAdapter = { ...createFixtureAdapter(), scopes: ["auctions"] } as SourceAdapter;
    const r = await runSyncJob(newJob(store, "nearby_sales"), limited, store, {});
    expect(r.status).toBe("failed");
  });
});

describe("retry", () => {
  it("retries transient errors then succeeds", async () => {
    let n = 0;
    const v = await withRetry(async () => {
      if (++n < 3) throw new AdapterError("transient", "blip");
      return "ok";
    }, noSleep);
    expect(v).toBe("ok");
    expect(n).toBe(3);
  });
  it("does not retry auth errors", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n++;
        throw new AdapterError("auth", "bad key");
      }, noSleep),
    ).rejects.toThrow("bad key");
    expect(n).toBe(1);
  });
  it("times out slow calls", async () => {
    await expect(withRetry(() => new Promise(() => {}), { ...noSleep, retries: 0, timeoutMs: 10 })).rejects.toMatchObject({ category: "timeout" });
  });
});

describe("log redaction", () => {
  it("removes credentials", () => {
    expect(redact("GET /x?api_key=abc123&y=1 Authorization: Bearer eyJhbGciOi")).not.toMatch(/abc123|eyJhbGciOi/);
  });
});
