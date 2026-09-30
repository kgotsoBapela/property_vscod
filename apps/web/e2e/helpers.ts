import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Role } from "@propintel/shared";

/** Demo mode only: switch the simulated role for this browser context / request context. */
export async function actAs(target: Page | APIRequestContext, role: Role) {
  const request = "request" in target ? target.request : target;
  const res = await request.post("/api/demo-role", { data: { role } });
  expect(res.status(), "demo-role switch").toBe(200);
}

/** Resolves a property id by searching, exactly as a user would. */
export async function findPropertyId(request: APIRequestContext, query: string): Promise<string> {
  const html = await (await request.get(`/search?q=${encodeURIComponent(query)}`)).text();
  const id = html.match(/href="\/properties\/([0-9a-f-]{36})"/)?.[1];
  expect(id, `search result for "${query}"`).toBeTruthy();
  return id!;
}
