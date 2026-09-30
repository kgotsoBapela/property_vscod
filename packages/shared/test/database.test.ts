import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createFixtureAdapter } from "../src/adapters/fixture";
import { runSyncJob } from "../src/sync/pipeline";
import { SqlSyncStore, type SqlExec } from "../src/sync/sql-store";
import type { SyncJob, SyncScope } from "../src/types/domain";
import { asUser, createTestDb } from "./support/pglite";

// Runs the real migrations on PostgreSQL (PGlite) and drives the sync pipeline through commit_sync_item.

let db: PGlite;
let exec: SqlExec;
let integrationId: string;
const users = {
  super: "11111111-1111-4111-8111-111111111111",
  admin: "22222222-2222-4222-8222-222222222222",
  viewer: "33333333-3333-4333-8333-333333333333",
  none: "44444444-4444-4444-8444-444444444444",
};
const noSleep = { retries: 1, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 5000, sleep: async () => {} };

async function createJob(scope: SyncScope, params: Record<string, unknown> = {}): Promise<SyncJob> {
  const rows = await exec<SyncJob>(
    `insert into public.sync_jobs (integration_id, scope, params, trigger) values ($1, $2, $3::jsonb, 'schedule') returning *`,
    [integrationId, scope, JSON.stringify(params)],
  );
  return rows[0]!;
}

async function count(table: string) {
  return Number((await exec<{ n: number }>(`select count(*)::int as n from public.${table}`))[0]!.n);
}

beforeAll(async () => {
  ({ db, exec } = await createTestDb());
  integrationId = (await exec<{ id: string }>("select id from public.integrations where provider_key = 'fixture_demo'"))[0]!.id;
  for (const [role, id] of Object.entries(users)) {
    const meta = role === "none" ? {} : { role: role === "super" ? "super_admin" : role };
    await exec("insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, $3::jsonb)", [id, `${role}@example.org`, JSON.stringify(meta)]);
  }
  const job = await createJob("full_reconciliation");
  const store = new SqlSyncStore(exec);
  const r = await runSyncJob(job, createFixtureAdapter(), store, {}, { retry: noSleep });
  expect(r.status).toBe("partially_completed");
}, 120_000);

describe("migrations + sync on PostgreSQL", () => {
  it("assigns roles from invitation metadata only", async () => {
    const roles = await exec<{ role: string }>("select role from public.user_roles order by role");
    expect(roles.map((r) => r.role)).toEqual(["admin", "super_admin", "viewer"]);
  });

  it("ingests fixture data with sectional units kept separate", async () => {
    expect(await count("properties")).toBeGreaterThan(80);
    expect(await count("auctions")).toBe(6);
    const units = await exec<{ n: number }>("select count(*)::int as n from public.properties where complex_name = 'FIXTURE COURT'");
    expect(units[0]!.n).toBe(12);
    const conflicts = await exec("select * from public.v_identifier_conflicts");
    expect(conflicts).toHaveLength(0);
  });

  it("is idempotent across repeated runs", async () => {
    const before = [await count("properties"), await count("property_sales"), await count("property_identifiers"), await count("auction_properties")];
    const r = await runSyncJob(await createJob("full_reconciliation"), createFixtureAdapter(), new SqlSyncStore(exec), {}, { retry: noSleep });
    expect(r.unchanged).toBeGreaterThan(80);
    expect([await count("properties"), await count("property_sales"), await count("property_identifiers"), await count("auction_properties")]).toEqual(before);
  });

  it("records auction lot matches and ambiguous lots for review", async () => {
    const rows = await exec<{ external_id: string; review_status: string; property_id: string | null; n: number }>(
      `select a.external_id, ap.review_status, ap.property_id, cardinality(ap.candidate_property_ids) as n
         from public.auction_properties ap join public.auctions a on a.id = ap.auction_id order by a.external_id`,
    );
    expect(rows.find((r) => r.external_id === "FXA-001")).toMatchObject({ review_status: "auto_matched" });
    expect(rows.find((r) => r.external_id === "FXA-006")).toMatchObject({ review_status: "needs_review", property_id: null, n: 12 });
  });

  it("prevents overlapping active jobs for the same scope", async () => {
    await createJob("auctions");
    await expect(createJob("auctions")).rejects.toThrow(/duplicate key|sync_jobs_no_overlap_idx/);
    await exec("update public.sync_jobs set status = 'cancelled' where scope = 'auctions'");
  });

  it("claims queued jobs atomically", async () => {
    const job = await createJob("provider_incremental");
    const claimed = await exec<SyncJob>("select * from public.claim_next_sync_job('w1')");
    expect(claimed[0]?.id).toBe(job.id);
    expect(claimed[0]?.status).toBe("running");
    expect(await exec("select * from public.claim_next_sync_job('w2')")).toHaveLength(0);
    await exec("update public.sync_jobs set status = 'completed' where id = $1", [job.id]);
  });

  it("keeps prior data when a refresh fails", async () => {
    const snapshot = async () => exec("select id, transfer_amount, registration_date from public.property_sales order by id");
    const before = await snapshot();
    const job = await createJob("provider_incremental", { simulate_failure: "first_page" });
    const r = await runSyncJob(job, createFixtureAdapter(), new SqlSyncStore(exec), {}, { retry: noSleep });
    expect(r.status).toBe("failed");
    expect(await snapshot()).toEqual(before);
    const saved = await exec<{ status: string; error_category: string }>("select status, error_category from public.sync_jobs where id = $1", [job.id]);
    expect(saved[0]).toMatchObject({ status: "failed", error_category: "transient" });
  });

  it("returns nearby sales for comparables", async () => {
    const subject = (await exec<{ id: string }>("select id from public.properties where latitude is not null limit 1"))[0]!.id;
    const rows = await exec("select * from public.nearby_sales($1, 1500, '2020-01-01')", [subject]);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("row level security", () => {
  it("lets every role read property data but blocks users without a role", async () => {
    for (const id of [users.super, users.admin, users.viewer]) {
      const n = await asUser(db, id, () => exec<{ n: number }>("select count(*)::int as n from public.properties"));
      expect(n[0]!.n).toBeGreaterThan(0);
    }
    const none = await asUser(db, users.none, () => exec<{ n: number }>("select count(*)::int as n from public.properties"));
    expect(none[0]!.n).toBe(0);
  });

  it("restricts raw source records to Super Admin", async () => {
    const admin = await asUser(db, users.admin, () => exec<{ n: number }>("select count(*)::int as n from public.source_records"));
    expect(admin[0]!.n).toBe(0);
    const sup = await asUser(db, users.super, () => exec<{ n: number }>("select count(*)::int as n from public.source_records"));
    expect(sup[0]!.n).toBeGreaterThan(0);
  });

  it("hides sync jobs from viewers and allows only Super Admin to trigger", async () => {
    const viewer = await asUser(db, users.viewer, () => exec<{ n: number }>("select count(*)::int as n from public.sync_jobs"));
    expect(viewer[0]!.n).toBe(0);
    const insert = (uid: string) =>
      asUser(db, uid, () =>
        exec(
          `insert into public.sync_jobs (integration_id, scope, trigger, requested_by, target_property_id)
           values ($1, 'subject_property', 'manual', $2, gen_random_uuid())`,
          [integrationId, uid],
        ),
      );
    await expect(insert(users.admin)).rejects.toThrow(/row-level security/);
    await expect(insert(users.viewer)).rejects.toThrow(/row-level security/);
    await expect(insert(users.super)).resolves.toBeDefined();
  });

  it("blocks non-service roles from privileged functions", async () => {
    await expect(asUser(db, users.super, () => exec("select public.commit_sync_item('{}'::jsonb)"))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, users.super, () => exec("select * from public.claim_next_sync_job('x')"))).rejects.toThrow(/permission denied/);
  });

  it("only lets Super Admin change roles", async () => {
    await expect(
      asUser(db, users.admin, () => exec("update public.user_roles set role = 'super_admin' where user_id = $1 returning *", [users.admin])),
    ).resolves.toHaveLength(0);
    const role = await exec<{ role: string }>("select role from public.user_roles where user_id = $1", [users.admin]);
    expect(role[0]!.role).toBe("admin");
  });
});
