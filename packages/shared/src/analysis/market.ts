import type { Property, PropertySale, PropertyType } from "../types/domain";
import { quantile } from "./comparables";

export interface MarketPoint {
  period: string; // e.g. "2025-H2"
  period_start: string;
  period_end: string;
  sample_count: number;
  median_price: number | null;
  median_price_per_m2: number | null;
}

/** Minimum sales per period before a median is shown; smaller samples are reported as insufficient. */
export const MIN_MARKET_SAMPLE = 3;

function halfYear(date: string) {
  const y = Number(date.slice(0, 4));
  const h = Number(date.slice(5, 7)) <= 6 ? 1 : 2;
  return { key: `${y}-H${h}`, start: h === 1 ? `${y}-01-01` : `${y}-07-01`, end: h === 1 ? `${y}-06-30` : `${y}-12-31` };
}

/**
 * Half-yearly median registered prices for a suburb and property type, from verified arm's-length
 * transfers only. Periods with fewer than MIN_MARKET_SAMPLE sales keep their count but no median.
 */
export function suburbMarketSeries(
  suburb: string,
  propertyType: PropertyType | "all",
  properties: Map<string, Property> | Property[],
  sales: Iterable<PropertySale>,
  fromDate: string,
): MarketPoint[] {
  const byId = properties instanceof Map ? properties : new Map(properties.map((p) => [p.id, p]));
  const buckets = new Map<string, { start: string; end: string; prices: number[]; ppm2: number[] }>();
  for (const s of sales) {
    const p = byId.get(s.property_id);
    if (!p || p.suburb !== suburb) continue;
    if (propertyType !== "all" && p.property_type !== propertyType) continue;
    if (!s.is_arms_length || s.verification_status !== "verified" || !s.transfer_amount || !s.registration_date) continue;
    if (s.registration_date < fromDate) continue;
    const h = halfYear(s.registration_date);
    const b = buckets.get(h.key) ?? { start: h.start, end: h.end, prices: [], ppm2: [] };
    b.prices.push(s.transfer_amount);
    if (p.floor_size_m2) b.ppm2.push(s.transfer_amount / p.floor_size_m2);
    buckets.set(h.key, b);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, b]) => {
      const enough = b.prices.length >= MIN_MARKET_SAMPLE;
      const med = quantile([...b.prices].sort((x, y) => x - y), 0.5);
      const medPpm2 = quantile([...b.ppm2].sort((x, y) => x - y), 0.5);
      return {
        period,
        period_start: b.start,
        period_end: b.end,
        sample_count: b.prices.length,
        median_price: enough && med != null ? Math.round(med) : null,
        median_price_per_m2: enough && medPpm2 != null ? Math.round(medPpm2) : null,
      };
    });
}

/** Trend from the first to the last period with a usable median, annualised. */
export function seriesTrend(series: MarketPoint[]): { annual_rate: number | null; basis: string } {
  const usable = series.filter((p) => p.median_price_per_m2 != null);
  if (usable.length < 2) return { annual_rate: null, basis: "Fewer than two periods with sufficient sales" };
  const first = usable[0]!;
  const last = usable[usable.length - 1]!;
  const years = (Date.parse(last.period_start) - Date.parse(first.period_start)) / (365.25 * 86_400_000);
  if (years < 1) return { annual_rate: null, basis: "Less than one year of usable data" };
  const rate = (last.median_price_per_m2! / first.median_price_per_m2!) ** (1 / years) - 1;
  return { annual_rate: rate, basis: `Median R/m² ${first.period} → ${last.period} (${usable.length} usable periods)` };
}
