import { z } from "zod";

// Normalized, provider-independent records. Every adapter maps its raw payload to one of these
// and the sync pipeline only ever persists validated normalized records.

const isoDate = z.iso.date();
const isoDateTime = z.iso.datetime({ offset: true });
const money = z.number().nonnegative().max(10_000_000_000);

export const verificationStatusSchema = z.enum(["verified", "unverified", "disputed", "superseded"]);
export const propertyTypeSchema = z.enum(["freehold", "sectional_title", "agricultural", "vacant_land", "commercial"]);
export const transferTypeSchema = z.enum([
  "market_sale",
  "sale_in_execution",
  "deceased_estate",
  "donation",
  "related_party",
  "divorce",
  "other",
]);

export const normalizedSaleSchema = z
  .object({
    external_id: z.string().min(1),
    transfer_amount: money.nullable(),
    sale_date: isoDate.nullable(),
    registration_date: isoDate.nullable(),
    transfer_type: transferTypeSchema,
    is_arms_length: z.boolean(),
    title_deed: z.string().nullable(),
    verification_status: verificationStatusSchema,
  })
  .refine((s) => !(s.sale_date && s.registration_date) || s.sale_date <= s.registration_date, {
    message: "sale_date must not be after registration_date",
  });

export const normalizedValuationSchema = z
  .object({
    external_id: z.string().min(1),
    model: z.string(),
    methodology_version: z.string(),
    point_estimate: money.nullable(),
    range_low: money.nullable(),
    range_high: money.nullable(),
    as_of_date: isoDate,
    confidence: z.enum(["high", "medium", "low", "insufficient_data"]),
    confidence_notes: z.string().nullable(),
  })
  .refine((v) => v.range_low == null || v.range_high == null || v.range_low <= v.range_high, {
    message: "range_low must be <= range_high",
  });

export const normalizedPropertySchema = z.object({
  type: z.literal("property"),
  external_id: z.string().min(1),
  address: z.string().min(3),
  street_number: z.string().nullable(),
  street_name: z.string().nullable(),
  unit_number: z.string().nullable(),
  complex_name: z.string().nullable(),
  suburb: z.string().min(1),
  municipality: z.string().nullable(),
  province: z.string().min(1),
  postal_code: z.string().nullable(),
  latitude: z.number().min(-35.5).max(-21.5).nullable(), // South Africa bounding box
  longitude: z.number().min(16).max(33.5).nullable(),
  property_type: propertyTypeSchema,
  erf_size_m2: z.number().positive().nullable(),
  floor_size_m2: z.number().positive().nullable(),
  bedrooms: z.number().int().min(0).max(50).nullable(),
  bathrooms: z.number().min(0).max(50).nullable(),
  erf_number: z.string().nullable(),
  portion: z.string().nullable(),
  township: z.string().nullable(),
  scheme_name: z.string().nullable(),
  scheme_number: z.string().nullable(),
  title_deed: z.string().nullable(),
  identifiers_verified: z.boolean(),
  sales: z.array(normalizedSaleSchema),
  valuations: z.array(normalizedValuationSchema),
});

export const auctionPriceSchema = z.object({
  kind: z.enum(["auction_guide", "auction_reserve", "opening_bid", "confirmed_hammer"]),
  amount: money.nullable(),
  published: z.boolean(),
});

export const normalizedSheriffOfficeSchema = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  jurisdiction: z.string().min(1),
  province: z.string().min(1),
  physical_address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.email().nullable(),
  contact_verified_at: isoDateTime.nullable(),
  source_url: z.url().nullable(),
});

export const normalizedAuctionSchema = z.object({
  type: z.literal("auction"),
  external_id: z.string().min(1),
  kind: z.enum(["sheriff_sale", "private_auction", "online_auction"]),
  auction_house: z.object({ external_id: z.string(), name: z.string(), website: z.url().nullable() }).nullable(),
  sheriff_office: normalizedSheriffOfficeSchema.nullable(),
  title: z.string().min(1),
  event_at: isoDateTime.nullable(),
  venue: z.string().nullable(),
  status: z.enum(["scheduled", "postponed", "cancelled", "sold", "no_sale", "withdrawn", "unknown"]),
  status_note: z.string().nullable(),
  prices: z.array(auctionPriceSchema),
  deposit_terms: z.string().nullable(),
  conditions_summary: z.string().nullable(),
  case_reference: z.string().nullable(),
  notice_url: z.url().nullable(),
  verified_at: isoDateTime.nullable(),
  lots: z.array(
    z.object({
      lot_number: z.string().nullable(),
      described_address: z.string(),
      erf_number: z.string().nullable(),
      portion: z.string().nullable(),
      township: z.string().nullable(),
      scheme_name: z.string().nullable(),
      scheme_number: z.string().nullable(),
      unit_number: z.string().nullable(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }),
  ),
  documents: z.array(
    z.object({
      external_id: z.string(),
      kind: z.enum(["notice", "conditions_of_sale", "gazette", "other"]),
      title: z.string(),
      url: z.url().nullable(),
      published_at: isoDateTime.nullable(),
    }),
  ),
});

export const normalizedRecordSchema = z.discriminatedUnion("type", [normalizedPropertySchema, normalizedAuctionSchema]);

export type NormalizedSale = z.infer<typeof normalizedSaleSchema>;
export type NormalizedValuation = z.infer<typeof normalizedValuationSchema>;
export type NormalizedProperty = z.infer<typeof normalizedPropertySchema>;
export type NormalizedAuction = z.infer<typeof normalizedAuctionSchema>;
export type NormalizedSheriffOffice = z.infer<typeof normalizedSheriffOfficeSchema>;
export type NormalizedRecord = z.infer<typeof normalizedRecordSchema>;
