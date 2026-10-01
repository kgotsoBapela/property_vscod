import { expect, test } from "@playwright/test";
import { actAs } from "./helpers";

test("super admin adds a provider and records what is known about it", async ({ page }) => {
  await actAs(page, "super_admin");
  await page.goto("/admin/integrations");
  await page.getByLabel("Provider name").fill("Test Deeds Provider");
  await expect(page.getByLabel("Key (permanent)")).toHaveValue("test_deeds_provider");
  await page.getByRole("button", { name: "Add integration" }).click();

  await expect(page).toHaveURL(/\/admin\/integrations\/test_deeds_provider$/);
  await expect(page.getByText("No connector yet")).toBeVisible();
  // Without a connector the provider cannot be made Sandbox or Active.
  await expect(page.getByLabel("Status").locator('option[value="active"]')).toBeDisabled();

  await page.getByLabel("Status").selectOption("in_discussion");
  await page.getByLabel("Cost per call (R)").fill("2.50");
  await page.getByLabel("Auth method").fill("API key header");
  await page.getByLabel("nearby sales").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Cost per call (R)")).toHaveValue("2.5");
  await expect(page.getByLabel("Auth method")).toHaveValue("API key header");
  await expect(page.getByLabel("nearby sales")).toBeChecked();

  // The server enforces the connector rule too, not just the disabled option.
  const res = await page.request.patch("/api/admin/integrations/test_deeds_provider", {
    data: {
      display_name: "Test Deeds Provider",
      status: "active",
      website: null,
      notes: null,
      auth_method: null,
      historical_coverage: null,
      geographic_coverage: null,
      update_frequency: null,
      quota_per_day: null,
      cost_per_call_zar: null,
      monthly_cost_zar: null,
      display_rights: null,
      retention_rights: null,
      automated_refresh_permitted: null,
      contact_owner: null,
      max_paid_calls_per_job: null,
      capabilities: [],
    },
  });
  expect(res.status()).toBe(409);

  await page.goto("/admin/audit");
  await expect(page.getByText("integration.create")).toBeVisible();
  await expect(page.getByText("integration.update").first()).toBeVisible();
});

test("admin can view providers but not edit them or see credentials", async ({ page }) => {
  await actAs(page, "admin");
  await page.goto("/admin/integrations");
  await expect(page.getByRole("button", { name: "Add integration" })).toHaveCount(0);
  await page.getByRole("link", { name: "View", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Provider details" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByText("API credentials")).toHaveCount(0);
});
