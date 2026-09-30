import { describe, expect, it } from "vitest";
import { enqueueDueSchedules } from "../src/jobs/scheduler";
import { createTestDb } from "../../../packages/shared/test/support/pglite";

describe("scheduler", () => {
  it("initialises next_run_at, then enqueues once when due without overlapping", async () => {
    const { exec } = await createTestDb();
    await exec("update public.sync_schedules set enabled = true where scope = 'provider_incremental'");
    const t0 = new Date("2026-09-29T10:00:00Z");
    expect(await enqueueDueSchedules(exec, t0)).toBe(0);
    const [s] = await exec<{ next_run_at: string }>("select next_run_at from public.sync_schedules where scope = 'provider_incremental'");
    expect(new Date(s!.next_run_at).toISOString()).toBe("2026-09-30T00:00:00.000Z");

    const due = new Date("2026-09-30T00:00:30Z");
    expect(await enqueueDueSchedules(exec, due)).toBe(1);
    // Force it due again while the first job is still queued: skipped by the overlap index.
    await exec("update public.sync_schedules set next_run_at = $1", [due]);
    expect(await enqueueDueSchedules(exec, due)).toBe(0);
  }, 60_000);
});
