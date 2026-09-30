import { z } from "zod";
import { propertyTypeSchema } from "./normalized";

// Validation for user-supplied input at API boundaries.

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, "Enter at least 2 characters").max(200),
});

export const comparableFiltersSchema = z.object({
  radius_m: z.coerce.number().int().min(100).max(20_000).default(1500),
  lookback_months: z.coerce.number().int().min(3).max(120).default(24),
  property_types: z
    .union([z.array(propertyTypeSchema), propertyTypeSchema.transform((v) => [v])])
    .nullable()
    .default(null),
  min_floor_m2: z.coerce.number().positive().nullable().default(null),
  max_floor_m2: z.coerce.number().positive().nullable().default(null),
  include_non_arms_length: z.coerce.boolean().default(false),
  verified_only: z.coerce.boolean().default(true),
  overrides: z.record(z.string(), z.enum(["include", "exclude"])).default({}),
});

export const syncScopeSchema = z.enum([
  "subject_property",
  "nearby_sales",
  "auctions",
  "provider_incremental",
  "full_reconciliation",
]);

export const createSyncJobSchema = z
  .object({
    integration_id: z.string().min(1),
    scope: syncScopeSchema,
    target_property_id: z.string().nullable().default(null),
    params: z
      .object({
        radius_m: z.number().int().min(100).max(20_000).optional(),
        lookback_months: z.number().int().min(3).max(120).optional(),
        simulate_failure: z.enum(["none", "after_first_page", "first_page"]).optional(),
      })
      .default({}),
    /** Full refreshes can be costly and require an explicit acknowledgement. */
    approve_high_cost: z.boolean().default(false),
  })
  .refine((v) => !["subject_property", "nearby_sales"].includes(v.scope) || v.target_property_id, {
    message: "A target property is required for this scope",
    path: ["target_property_id"],
  });

export const scheduleUpdateSchema = z.object({
  integration_id: z.string().min(1),
  schedule_cron: z
    .string()
    .regex(/^(\S+\s+){4}\S+$/, "Use a 5-field cron expression")
    .nullable(),
  schedule_enabled: z.boolean(),
});

export const inviteUserSchema = z.object({
  email: z.email(),
  role: z.enum(["super_admin", "admin", "viewer"]),
});

export const scenarioInputSchema = z.object({
  purchase_price: z.coerce.number().positive(),
  purchase_route: z.enum(["auction", "sheriff_sale", "private_treaty"]),
  vat_transaction: z.coerce.boolean().default(false),
  buyer_commission_pct: z.coerce.number().min(0).max(20).nullable(),
  conveyancing_fees: z.coerce.number().min(0).nullable(),
  bond_costs: z.coerce.number().min(0).nullable(),
  rates_arrears: z.coerce.number().min(0).nullable(),
  levy_arrears: z.coerce.number().min(0).nullable(),
  sheriff_or_auction_fees: z.coerce.number().min(0).nullable(),
  renovation_allowance: z.coerce.number().min(0).nullable(),
  holding_costs: z.coerce.number().min(0).nullable(),
  other_costs: z.coerce.number().min(0).nullable(),
});

export type CreateSyncJobInput = z.infer<typeof createSyncJobSchema>;
export type ComparableFiltersInput = z.infer<typeof comparableFiltersSchema>;
