import "server-only";
import {
  analyzeComparables,
  DEFAULT_COMPARABLE_FILTERS,
  seriesTrend,
  type ComparableFilters,
} from "@propintel/shared";
import type { DataRepository, PropertyDetail } from "@/lib/data/types";

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function monthsAgoIso(months: number, from = new Date()) {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** Runs the explainable comparable analysis for a property using stored analyst overrides. */
export async function comparableAnalysisFor(repo: DataRepository, detail: PropertyDetail, filters: Partial<ComparableFilters> = {}) {
  const overrides = await repo.getComparableOverrides(detail.property.id);
  const f: ComparableFilters = { ...DEFAULT_COMPARABLE_FILTERS, ...filters, overrides: { ...overrides, ...(filters.overrides ?? {}) } };
  const candidates = await repo.getComparableCandidates(detail.property.id, f.radius_m, monthsAgoIso(f.lookback_months));
  const trend = seriesTrend(detail.market_series);
  return { analysis: analyzeComparables(detail.property, candidates, f, todayIso(), trend.annual_rate), trend };
}
