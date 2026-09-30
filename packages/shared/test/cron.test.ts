import { describe, expect, it } from "vitest";
import { nextCronRun, parseCron } from "../src/sync/cron";

describe("cron", () => {
  it("runs daily at 02:00 Johannesburg (00:00 UTC)", () => {
    const next = nextCronRun("0 2 * * *", "Africa/Johannesburg", new Date("2026-09-29T10:00:00Z"));
    expect(next?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
  it("supports lists and steps", () => {
    expect(nextCronRun("0 6,18 * * *", "Africa/Johannesburg", new Date("2026-09-29T05:00:00Z"))?.toISOString()).toBe("2026-09-29T16:00:00.000Z");
    expect(nextCronRun("*/15 * * * *", "UTC", new Date("2026-09-29T10:07:00Z"))?.toISOString()).toBe("2026-09-29T10:15:00.000Z");
  });
  it("respects day-of-week", () => {
    // 2026-09-29 is a Tuesday; next Monday is 2026-10-05
    expect(nextCronRun("30 3 * * 1", "UTC", new Date("2026-09-29T00:00:00Z"))?.toISOString()).toBe("2026-10-05T03:30:00.000Z");
  });
  it("rejects invalid expressions", () => {
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* * *")).toThrow();
  });
});
