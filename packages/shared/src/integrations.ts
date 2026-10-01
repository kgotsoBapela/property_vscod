import { z } from "zod";
import type { IntegrationStatus } from "./types/domain";

/**
 * Provider keys that have a connector (SourceAdapter) in apps/worker/src/adapters/registry.ts.
 * An integration can only be set to sandbox/active once its key is listed here; otherwise every sync
 * would fail with "not configured".
 */
export const IMPLEMENTED_ADAPTERS: readonly string[] = ["fixture_demo"];

export function hasAdapter(providerKey: string): boolean {
  return IMPLEMENTED_ADAPTERS.includes(providerKey);
}

export const INTEGRATION_STATUSES: IntegrationStatus[] = ["candidate", "in_discussion", "sandbox", "active", "suspended", "rejected"];

export const INTEGRATION_STATUS_LABELS: Record<IntegrationStatus, string> = {
  candidate: "Candidate",
  in_discussion: "In discussion",
  sandbox: "Sandbox (testing)",
  active: "Active",
  suspended: "Suspended",
  rejected: "Rejected",
};

export const INTEGRATION_CAPABILITIES = ["subject_property", "nearby_sales", "auctions", "provider_incremental", "full_reconciliation"] as const;

/** Common credential names offered in the UI; any lowercase snake_case name is allowed. */
export const SUGGESTED_CREDENTIALS = ["api_key", "client_id", "client_secret", "username", "password", "base_url"] as const;

const text = z.string().trim().max(500).nullable();
const money = z.number().min(0).max(1_000_000).nullable();

export const integrationCreateSchema = z.object({
  provider_key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{2,40}$/, "Use 3–41 lowercase letters, digits or underscores, starting with a letter"),
  display_name: z.string().trim().min(2).max(100),
  category: z.enum(["property_data", "auctions", "sheriff_notices", "gazette"]),
  website: z.url().max(300).nullable(),
});

export const integrationUpdateSchema = z.object({
  display_name: z.string().trim().min(2).max(100),
  status: z.enum(["candidate", "in_discussion", "sandbox", "active", "suspended", "rejected"]),
  website: z.url().max(300).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  auth_method: text,
  historical_coverage: text,
  geographic_coverage: text,
  update_frequency: text,
  quota_per_day: z.number().int().min(0).max(10_000_000).nullable(),
  cost_per_call_zar: money,
  monthly_cost_zar: money,
  display_rights: text,
  retention_rights: text,
  automated_refresh_permitted: z.boolean().nullable(),
  contact_owner: text,
  max_paid_calls_per_job: z.number().int().min(1).max(1_000_000).nullable(),
  capabilities: z.array(z.enum(INTEGRATION_CAPABILITIES)).max(5),
});

export const credentialSetSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/, "Use lowercase letters, digits or underscores"),
  value: z.string().min(1).max(8192),
});

export type IntegrationCreateInput = z.infer<typeof integrationCreateSchema>;
export type IntegrationUpdateInput = z.infer<typeof integrationUpdateSchema>;
