import { expect, test } from "@playwright/test";
import { actAs, findPropertyId } from "./helpers";

// CLAUDE.md first end-to-end milestone, on synthetic data:
// search → resolve legal property → up to five registered transfers → nearby comps → explainable analysis
// → Super Admin refresh → job log → a failed refresh preserves the prior results.

test.beforeEach(async ({ page }) => {
  await actAs(page, "super_admin");
});

test("search, resolve, history, comparables, report", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox", { name: "Search properties" }).or(page.getByLabel("Search properties")).fill("erf 107");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search\?q=erf/);
  await expect(page.getByText(/Erf 107/).first()).toBeVisible();
  await page.locator('a[href^="/properties/"]').first().click();

  await expect(page.getByRole("heading", { name: "Most recent verified registered transfers" })).toBeVisible();
  await expect(page.getByText(/Showing the 5 most recent|Only \d+ verified registered transfer/)).toBeVisible();
  await expect(page.getByText("Registered transfer").first()).toBeVisible();
  await expect(page.getByText(/Source: .*fixture_demo/).first()).toBeVisible();

  await page.getByRole("link", { name: "Comparables" }).click();
  await expect(page.getByRole("heading", { name: "Comparable indication" })).toBeVisible();
  await expect(page.getByText(/candidate sales passed the filters/)).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();

  await page.goBack();
  await page.getByRole("link", { name: "Report" }).click();
  await expect(page.getByRole("heading", { name: "Property analysis report" })).toBeVisible();
  await expect(page.getByText("SYNTHETIC DEMO DATA.")).toBeVisible();
  const csv = await page.request.get(page.url().replace("/properties/", "/api/properties/").replace("/report", "/export?format=csv"));
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain('"meta","synthetic_demo_data","true"');
});

test("super admin refresh completes and shows a job log", async ({ page }) => {
  const pid = await findPropertyId(page.request, "erf 114");
  await page.goto(`/properties/${pid}`);
  await page.getByRole("button", { name: "Refresh property" }).click();
  await expect(page).toHaveURL(/\/sync\/[0-9a-f-]+$/);
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Page 1 committed/)).toBeVisible();
});

test("a failed refresh preserves prior results", async ({ page }) => {
  const pid = await findPropertyId(page.request, "erf 107");
  const snapshot = async () => {
    const r = await page.request.get(`/api/properties/${pid}/comparables`);
    const j = await r.json();
    return { median: j.analysis.indication.median_adjusted, n: j.analysis.indication.sample_count, comps: j.analysis.comps.length };
  };
  const before = await snapshot();

  await page.goto("/sync");
  await page.getByLabel("Scope").selectOption("provider_incremental");
  await page.getByLabel("Failure injection (demo provider only)").selectOption("first_page");
  await page.getByRole("button", { name: "Queue job" }).click();
  await expect(page).toHaveURL(/\/sync\/[0-9a-f-]+$/);
  await expect(page.getByText("Failed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Previously stored data was not modified/)).toBeVisible();

  expect(await snapshot()).toEqual(before);
});

test("a second identical job is rejected while the first is active", async ({ page }) => {
  const start = () => page.request.post("/api/sync/jobs", { data: { integration_id: "fixture", scope: "auctions", params: {} } });
  const first = await start();
  expect(first.status()).toBe(200);
  const second = await start();
  expect(second.status()).toBe(409);
});

test("scenario calculator never treats unknown costs as zero", async ({ page }) => {
  const pid = await findPropertyId(page.request, "erf 107");
  await page.goto(`/scenarios?property=${pid}`);
  await page.getByLabel("Bid / offer price (R)").fill("1500000");
  await expect(page.getByText("Known costs (total is at least)")).toBeVisible();
  await expect(page.getByText(/cost item\(s\) are unknown and excluded from the total/)).toBeVisible();
  await expect(page.getByRole("cell", { name: /R\s8\s700/ })).toBeVisible(); // transfer duty on R1.5m
});
