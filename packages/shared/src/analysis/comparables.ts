import type { ComparableCandidate, Property, PropertyType } from "../types/domain";
import { haversineMeters } from "./geo";

export interface ComparableFilters {
  radius_m: number;
  lookback_months: number;
  property_types: PropertyType[] | null; // null = same type as subject
  min_floor_m2: number | null;
  max_floor_m2: number | null;
  include_non_arms_length: boolean;
  verified_only: boolean;
  /** Manual overrides from an analyst: sale id -> include/exclude */
  overrides: Record<string, "include" | "exclude">;
}

export const DEFAULT_COMPARABLE_FILTERS: ComparableFilters = {
  radius_m: 1500,
  lookback_months: 24,
  property_types: null,
  min_floor_m2: null,
  max_floor_m2: null,
  include_non_arms_length: false,
  verified_only: true,
  overrides: {},
};

export interface Adjustment {
  factor: "floor_size" | "time";
  amount: number;
  explanation: string;
}

export interface ComparableResult {
  sale_id: string;
  property_id: string;
  address: string;
  property_type: PropertyType;
  sale_price: number | null;
  registration_date: string | null;
  floor_size_m2: number | null;
  bedrooms: number | null;
  distance_m: number | null;
  included: boolean;
  exclusion_reasons: string[];
  manually_overridden: boolean;
  adjustments: Adjustment[];
  adjusted_price: number | null;
  weight: number;
  is_demo: boolean;
}

export type Confidence = "high" | "medium" | "low" | "insufficient_data";

export interface ComparableIndication {
  sample_count: number;
  median_adjusted: number | null;
  weighted_mean: number | null;
  range_low: number | null; // 25th percentile of adjusted prices
  range_high: number | null; // 75th percentile of adjusted prices
  median_price_per_m2: number | null;
  dispersion: number | null; // IQR / median
  confidence: Confidence;
  explanation: string[];
}

export interface ComparableAnalysis {
  as_of: string;
  filters: ComparableFilters;
  comps: ComparableResult[];
  indication: ComparableIndication;
}

/** Marginal square metres are valued below the average R/m² (land and fixed costs don't scale). */
export const SIZE_ADJUSTMENT_ELASTICITY = 0.6;

export function monthsBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() - a.getUTCDate()) / 30;
}

export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return a + (b - a) * (pos - lo);
}

function median(values: number[]): number | null {
  return quantile([...values].sort((x, y) => x - y), 0.5);
}

function describeAddress(p: Property) {
  return p.normalized_address;
}

/**
 * Explainable comparable-sales analysis. Pure function: same inputs, same output.
 * `annualGrowthRate` (e.g. 0.04) comes from market statistics; when null no time adjustment is made
 * and the explanation says so.
 */
export function analyzeComparables(
  subject: Property,
  candidates: ComparableCandidate[],
  filters: ComparableFilters,
  asOf: string,
  annualGrowthRate: number | null,
): ComparableAnalysis {
  const allowedTypes = filters.property_types ?? [subject.property_type];

  const results: ComparableResult[] = candidates.map(({ sale, property }) => {
    const reasons: string[] = [];
    const distance =
      subject.latitude != null && subject.longitude != null && property.latitude != null && property.longitude != null
        ? haversineMeters(subject.latitude, subject.longitude, property.latitude, property.longitude)
        : null;

    if (property.id === subject.id) reasons.push("Subject property itself");
    if (sale.transfer_amount == null) reasons.push("Transfer amount not disclosed");
    if (distance == null) reasons.push("No licensed coordinates; distance unknown");
    else if (distance > filters.radius_m) reasons.push(`Outside ${filters.radius_m} m radius`);
    const date = sale.registration_date ?? sale.sale_date;
    if (!date) reasons.push("No registration date");
    else if (monthsBetween(date, asOf) > filters.lookback_months) reasons.push(`Older than ${filters.lookback_months} months`);
    if (!allowedTypes.includes(property.property_type)) reasons.push(`Property type ${property.property_type} not selected`);
    if (!filters.include_non_arms_length && !sale.is_arms_length) reasons.push(`Non-arm's-length transfer (${sale.transfer_type})`);
    if (filters.verified_only && sale.verification_status !== "verified") reasons.push(`Sale ${sale.verification_status}`);
    if (filters.min_floor_m2 != null && (property.floor_size_m2 ?? 0) < filters.min_floor_m2) reasons.push("Below minimum floor size");
    if (filters.max_floor_m2 != null && (property.floor_size_m2 ?? Infinity) > filters.max_floor_m2) reasons.push("Above maximum floor size");

    const override = filters.overrides[sale.id];
    // Hard reasons cannot be overridden: we cannot value against a missing price or the subject itself.
    const hard = property.id === subject.id || sale.transfer_amount == null;
    let included = reasons.length === 0;
    let manuallyOverridden = false;
    if (override === "exclude" && included) {
      included = false;
      manuallyOverridden = true;
      reasons.push("Excluded by analyst");
    } else if (override === "include" && !included && !hard) {
      included = true;
      manuallyOverridden = true;
    }

    return {
      sale_id: sale.id,
      property_id: property.id,
      address: describeAddress(property),
      property_type: property.property_type,
      sale_price: sale.transfer_amount,
      registration_date: date,
      floor_size_m2: property.floor_size_m2,
      bedrooms: property.bedrooms,
      distance_m: distance == null ? null : Math.round(distance),
      included,
      exclusion_reasons: reasons,
      manually_overridden: manuallyOverridden,
      adjustments: [],
      adjusted_price: null,
      weight: 0,
      is_demo: property.is_demo || sale.provenance.is_demo,
    };
  });

  const included = results.filter((r) => r.included);
  const ppm2 = median(
    included.filter((r) => r.sale_price && r.floor_size_m2).map((r) => r.sale_price! / r.floor_size_m2!),
  );

  for (const r of included) {
    let adjusted = r.sale_price!;
    if (subject.floor_size_m2 != null && r.floor_size_m2 != null && ppm2 != null) {
      const diff = subject.floor_size_m2 - r.floor_size_m2;
      if (diff !== 0) {
        const amount = Math.round(diff * ppm2 * SIZE_ADJUSTMENT_ELASTICITY);
        r.adjustments.push({
          factor: "floor_size",
          amount,
          explanation: `Subject is ${Math.abs(diff)} m² ${diff > 0 ? "larger" : "smaller"}; ${Math.abs(diff)} m² × median R${Math.round(ppm2)}/m² × ${SIZE_ADJUSTMENT_ELASTICITY} elasticity`,
        });
        adjusted += amount;
      }
    }
    if (annualGrowthRate != null && r.registration_date) {
      const months = Math.max(0, monthsBetween(r.registration_date, asOf));
      const factor = (1 + annualGrowthRate) ** (months / 12) - 1;
      const amount = Math.round(r.sale_price! * factor);
      if (amount !== 0) {
        r.adjustments.push({
          factor: "time",
          amount,
          explanation: `${months.toFixed(1)} months at ${(annualGrowthRate * 100).toFixed(1)}% p.a. area trend`,
        });
        adjusted += amount;
      }
    }
    r.adjusted_price = adjusted;
    const distanceKm = (r.distance_m ?? filters.radius_m) / 1000;
    const ageYears = r.registration_date ? Math.max(0, monthsBetween(r.registration_date, asOf)) / 12 : 2;
    r.weight = Number((1 / (1 + distanceKm) / (1 + ageYears)).toFixed(4));
  }

  const adjustedSorted = included.map((r) => r.adjusted_price!).sort((a, b) => a - b);
  const n = adjustedSorted.length;
  const med = quantile(adjustedSorted, 0.5);
  const low = quantile(adjustedSorted, 0.25);
  const high = quantile(adjustedSorted, 0.75);
  const totalWeight = included.reduce((s, r) => s + r.weight, 0);
  const weightedMean = totalWeight > 0 ? included.reduce((s, r) => s + r.weight * r.adjusted_price!, 0) / totalWeight : null;
  const dispersion = med && low != null && high != null ? (high - low) / med : null;

  let confidence: Confidence = "insufficient_data";
  if (n >= 8 && dispersion != null && dispersion < 0.25) confidence = "high";
  else if (n >= 4 && dispersion != null && dispersion < 0.4) confidence = "medium";
  else if (n >= 1) confidence = "low";

  const explanation: string[] = [];
  explanation.push(`${n} of ${results.length} candidate sales passed the filters.`);
  if (n === 0) explanation.push("No comparable indication can be given; widen the radius or lookback, or obtain more licensed data.");
  if (ppm2 != null) explanation.push(`Median registered price per m² among included sales: R${Math.round(ppm2)}.`);
  else explanation.push("Floor sizes unavailable for included sales; no size adjustment applied.");
  if (annualGrowthRate == null) explanation.push("No area trend available; no time adjustment applied.");
  else explanation.push(`Time adjustment uses a ${(annualGrowthRate * 100).toFixed(1)}% p.a. area trend from market statistics.`);
  if (dispersion != null) explanation.push(`Interquartile spread is ${(dispersion * 100).toFixed(0)}% of the median.`);
  explanation.push("Weights favour nearer and more recent sales: 1/(1+km) × 1/(1+years).");
  if (results.some((r) => r.is_demo)) explanation.push("Includes SYNTHETIC DEMO data; not suitable for decisions.");

  return {
    as_of: asOf,
    filters,
    comps: results.sort((a, b) => Number(b.included) - Number(a.included) || (a.distance_m ?? 1e12) - (b.distance_m ?? 1e12)),
    indication: {
      sample_count: n,
      median_adjusted: med == null ? null : Math.round(med),
      weighted_mean: weightedMean == null ? null : Math.round(weightedMean),
      range_low: low == null ? null : Math.round(low),
      range_high: high == null ? null : Math.round(high),
      median_price_per_m2: ppm2 == null ? null : Math.round(ppm2),
      dispersion,
      confidence,
      explanation,
    },
  };
}
