import { expect, test } from "@playwright/test";
import type { Role } from "@propintel/shared";
import { actAs, findPropertyId } from "./helpers";

// Server-side authorization for every role. UI hiding is not tested here; the server must refuse on its own.

type Expect = Record<Role, number>;
const all = (n: number): Expect => ({ super_admin: n, admin: n, viewer: n });

test.describe("API authorization matrix", () => {
  for (const role of ["super_admin", "admin", "viewer"] as Role[]) {
    test(`as ${role}`, async ({ playwright, baseURL }) => {
      const request = await playwright.request.newContext({ baseURL });
      await actAs(request, role);
      const pid = await findPropertyId(request, "erf 107");

      const cases: { name: string; call: () => Promise<number>; expected: Expect }[] = [
        { name: "GET comparables", call: async () => (await request.get(`/api/properties/${pid}/comparables`)).status(), expected: all(200) },
        { name: "GET export", call: async () => (await request.get(`/api/properties/${pid}/export`)).status(), expected: all(200) },
        { name: "GET sync jobs", call: async () => (await request.get("/api/sync/jobs")).status(), expected: { super_admin: 200, admin: 200, viewer: 403 } },
        {
          name: "POST comparable override (invalid sale id)",
          call: async () => (await request.post(`/api/properties/${pid}/comparables`, { data: { sale_id: "not-a-sale", value: null } })).status(),
          expected: { super_admin: 200, admin: 200, viewer: 403 },
        },
        {
          name: "POST sync job (invalid body)",
          call: async () => (await request.post("/api/sync/jobs", { data: {} })).status(),
          // Authorization is checked before validation: only Super Admin reaches the 400.
          expected: { super_admin: 400, admin: 403, viewer: 403 },
        },
        {
          name: "PATCH schedule (invalid cron)",
          call: async () => (await request.patch("/api/sync/schedules/sched-auctions", { data: { cron: "not a cron!", enabled: false } })).status(),
          expected: { super_admin: 400, admin: 403, viewer: 403 },
        },
        {
          name: "POST review decision (invalid body)",
          call: async () => (await request.post("/api/review", { data: { kind: "identity" } })).status(),
          expected: { super_admin: 400, admin: 400, viewer: 403 },
        },
        {
          name: "POST integration (invalid body)",
          call: async () => (await request.post("/api/admin/integrations", { data: {} })).status(),
          expected: { super_admin: 400, admin: 403, viewer: 403 },
        },
        {
          name: "PUT credential",
          call: async () => (await request.put("/api/admin/integrations/lightstone/secrets", { data: { name: "api_key", value: "secret-value" } })).status(),
          // Demo mode has no Vault: Super Admin gets 409, others are refused before that.
          expected: { super_admin: 409, admin: 403, viewer: 403 },
        },
        {
          name: "POST invite",
          call: async () => (await request.post("/api/admin/invite", { data: { email: "x@example.org", role: "viewer" } })).status(),
          // Demo mode has no Supabase Auth: permitted roles get 400, others 403.
          expected: { super_admin: 400, admin: 400, viewer: 403 },
        },
        {
          name: "POST invite as admin role",
          call: async () => (await request.post("/api/admin/invite", { data: { email: "x@example.org", role: "admin" } })).status(),
          expected: { super_admin: 400, admin: 403, viewer: 403 },
        },
      ];

      const got = Object.fromEntries(await Promise.all(cases.map(async (c) => [c.name, await c.call()] as const)));
      const want = Object.fromEntries(cases.map((c) => [c.name, c.expected[role]]));
      expect(got).toEqual(want);
      await request.dispose();
    });
  }

  test("rejects unknown demo roles", async ({ request }) => {
    expect((await request.post("/api/demo-role", { data: { role: "owner" } })).status()).toBe(400);
  });
});

test.describe("page access", () => {
  const restricted = ["/sync", "/admin/integrations", "/admin/users", "/review"];

  test("viewer is redirected away from admin pages and has no admin navigation", async ({ page }) => {
    await actAs(page, "viewer");
    for (const path of restricted) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/forbidden/);
    }
    await page.goto("/");
    const nav = page.locator("aside nav");
    await expect(nav.getByRole("link", { name: "Overview" })).toBeVisible();
    for (const hidden of ["Sync center", "Integrations", "Team & roles", "Identity review"]) {
      await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);
    }
  });

  test("admin can read sync but cannot trigger", async ({ page }) => {
    await actAs(page, "admin");
    await page.goto("/sync");
    await expect(page.getByRole("heading", { name: "Sync center" })).toBeVisible();
    await expect(page.getByText("Only Super Admins can trigger syncs.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Queue job" })).toHaveCount(0);
  });
});
