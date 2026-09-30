import { expect, test } from "@playwright/test";
import { actAs } from "./helpers";

// An auction lot described only by street address matches 12 sectional units; a reviewer picks the right one.

test("admin confirms an ambiguous auction lot and the auction shows the match", async ({ page }) => {
  await actAs(page, "admin");
  await page.goto("/review");
  const card = page.locator("div.rounded-lg").filter({ hasText: "Auction lot" }).filter({ hasText: "12 Sample Avenue, Sample Heights" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/Candidate properties \(12\)/)).toBeVisible();

  const unit4 = card.locator("div.rounded-md.border").filter({ hasText: "unit 4" }).first();
  await unit4.getByRole("button", { name: "This is the property" }).click();
  await unit4.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("12 Sample Avenue, Sample Heights")).toHaveCount(0);

  await page.goto("/auctions?scope=all");
  await page.getByRole("link", { name: /unit described by street address only/ }).click();
  await expect(page.getByText(/Matched to/)).toBeVisible();
  await expect(page.getByText(/Confirmed by reviewer/)).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByText("auction_lot.confirm")).toBeVisible();
});
